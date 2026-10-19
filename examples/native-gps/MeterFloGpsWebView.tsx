/**
 * Integration screen for the SEPARATELY MAINTAINED Expo app.
 * Dependencies there: expo-location and react-native-webview. Not a new app.
 * Hardware/vendor integrations can replace Location.getCurrentPositionAsync.
 */
import React, { useRef, useEffect } from "react";
import { Platform } from "react-native";
import * as Location from "expo-location";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

export function MeterFloGpsWebView({ siteUrl }: { siteUrl: string }) {
  const view = useRef<WebView>(null);
  const active = useRef(new Set<string>());
  const origin = new URL(siteUrl).origin;
  if (!origin.startsWith("https://")) throw new Error("MeterFlo requires an approved HTTPS site.");
  useEffect(() => () => active.current.clear(), []);
  // Call Location.requestForegroundPermissionsAsync() in an explicit native
  // device-setup action before opening this screen. Never request background tracking.
  const inject = `
    (() => {
      if (location.origin !== ${JSON.stringify(origin)} || window.top !== window || window.meterfloGps) return;
      const pending = new Map();
      window.addEventListener("meterflo-gps-result", event => {
        const response = event.detail;
        const callback = pending.get(response?.id);
        if (!callback || response.origin !== location.origin || response.version !== 1) return;
        pending.delete(response.id);
        response.error ? callback.reject(new Error("Native location unavailable")) : callback.resolve(response);
      });
      window.meterfloGps = {
        version: 1, origin: location.origin,
        capture(request) { return new Promise((resolve,reject) => {
          pending.set(request.id,{resolve,reject});
          window.ReactNativeWebView.postMessage(JSON.stringify({type:"capture",...request}));
        }); },
        cancel(id) {
          const callback = pending.get(id);
          pending.delete(id);
          callback?.reject(new Error("Capture cancelled"));
          window.ReactNativeWebView.postMessage(JSON.stringify({type:"cancel",id,origin:location.origin}));
        }
      };
    })(); true;
  `;
  async function onMessage(event: WebViewMessageEvent) {
    let request: any;
    try { request = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (new URL(event.nativeEvent.url).origin !== origin || request.origin !== origin ||
        typeof request.id !== "string" || !/^[a-f0-9-]{36}$/i.test(request.id)) return;
    if (request.type === "cancel") { active.current.delete(request.id); return; }
    if (request.type !== "capture" || request.version !== 1 || !Number.isFinite(request.startedAt) ||
        Math.abs(Date.now() - request.startedAt) > 15000 || active.current.has(request.id) || active.current.size >= 2) return;
    active.current.add(request.id);
    const timer = setTimeout(() => active.current.delete(request.id), 8000);
    let response: any;
    try {
      if (Platform.OS === "web" || (await Location.getForegroundPermissionsAsync()).status !== "granted")
        throw new Error("Enable foreground location in native device setup.");
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      response = { version: 1, id: request.id, origin, fix: {
        coordinates: `${position.coords.latitude}, ${position.coords.longitude}`,
        source: "native", receiver: "unknown", accuracy: position.coords.accuracy,
        capturedAt: new Date(position.timestamp).toISOString(),
      } };
    } catch { response = { version: 1, id: request.id, origin, error: "Native location unavailable" }; }
    clearTimeout(timer);
    if (!active.current.delete(request.id)) return;
    view.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent("meterflo-gps-result",{detail:${JSON.stringify(response)}}));true;`);
  }
  return <WebView ref={view} source={{ uri: siteUrl }} onMessage={onMessage}
    injectedJavaScriptBeforeContentLoaded={inject} injectedJavaScript={inject}
    originWhitelist={[origin]} mixedContentMode="never"
    onShouldStartLoadWithRequest={request => {
      try { return new URL(request.url).origin === origin; } catch { return false; }
    }} />;
}
