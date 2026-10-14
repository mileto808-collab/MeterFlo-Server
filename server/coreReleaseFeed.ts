import { compareReleaseVersions } from "../shared/customer-release";
export async function readPublicCoreFeed(source:string,request:typeof fetch=fetch) {
  const url=new URL(source),parts=url.pathname.replace(/\.git$/,"").split("/").filter(Boolean);
  if(url.hostname!=="github.com" || parts.length!==2 || parts.some(p=>!/^[a-zA-Z0-9_.-]+$/.test(p)))
    throw new Error("This provider requires workspace Git access");
  const [owner,repo]=parts;
  const get=async(address:string)=>{
    const response=await request(address,{headers:{"User-Agent":"MeterFlo-Core-Updates"},signal:AbortSignal.timeout(7000)});
    if(!response.ok)throw new Error("Public core metadata is unavailable; verify source access in the workspace");
    return await response.json() as any;
  };
  const release=await get(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
  if(typeof release.tag_name!=="string" || !/^v\d+\.\d+\.\d+$/.test(release.tag_name))throw new Error("Release tag is not numbered");
  const base=`https://raw.githubusercontent.com/${owner}/${repo}/refs/tags/${release.tag_name}`;
  const [pkg,metadata]=await Promise.all([get(`${base}/package.json`),get(`${base}/meterflo.release.json`)]);
  compareReleaseVersions(pkg.version,pkg.version);
  if(pkg.version!==release.tag_name.slice(1))throw new Error("Core release tag and package version differ");
  return {tag:release.tag_name,version:pkg.version,metadata};
}
