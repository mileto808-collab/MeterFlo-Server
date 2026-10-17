// Recovery is optional: blocked/disabled browser storage must not prevent a
// technician from calculating or navigating a route in the current view.
export const routeSessionStorage = {
  get length() { try { return window.sessionStorage.length; } catch { return 0; } },
  key(index: number) { try { return window.sessionStorage.key(index); } catch { return null; } },
  getItem(key: string) { try { return window.sessionStorage.getItem(key); } catch { return null; } },
  removeItem(key: string) { try { window.sessionStorage.removeItem(key); } catch { /* No readable cache. */ } },
  setItem(key: string, value: string) {
    try { window.sessionStorage.setItem(key, value); return true; } catch { return false; }
  },
};
