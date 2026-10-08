import {NativeModules,Platform} from 'react-native';
import {channel,newer,parseManifest,UPDATE_URL,type UpdateManifest} from '../../../packages/companion/src/updates.js';
import Constants from 'expo-constants';
const installer=NativeModules.PulseInstaller;
export const appVersion=Constants.expoConfig?.version??'0.3.1';
export async function checkUpdates(selected='test'):Promise<UpdateManifest|null>{
 if(Platform.OS!=='android')return null;
 const response=await fetch(`${UPDATE_URL}/${channel(selected)}/latest.json`,{headers:{Accept:'application/json'}});
 if(response.status===204)return null;if(!response.ok)throw Error('Update check unavailable');
 const manifest=parseManifest(await response.json(),selected);
 return newer(manifest.version,appVersion)?manifest:null;
}
export async function prepareUpdate(manifest:UpdateManifest){
 const apk=manifest.files.find(f=>f.platform==='android'&&f.kind==='apk');
 if(!apk||!installer)throw Error('Android update is unavailable');
 return await installer.download(apk.url,apk.sha256,apk.size) as string;
}
export const canInstallUpdate=()=>installer.canInstall() as Promise<boolean>;
export const openInstallPermission=()=>installer.openPermission() as Promise<void>;
export const installUpdate=(name:string)=>installer.install(name) as Promise<'permission'|'installer'>;
