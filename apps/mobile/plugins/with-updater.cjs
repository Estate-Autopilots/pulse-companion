// Native APK handoff. Android itself checks the installed app's signing identity at installation.
const {withAndroidManifest,withDangerousMod,withMainApplication}=require('expo/config-plugins');
const fs=require('node:fs'),path=require('node:path');
module.exports=config=>{
 config=withAndroidManifest(config,c=>{
  const app=c.modResults.manifest.application[0];
  app.provider??=[];
  if(!app.provider.some(p=>p.$['android:authorities']==='${applicationId}.pulse.updates'))app.provider.push({$:{'android:name':'androidx.core.content.FileProvider','android:authorities':'${applicationId}.pulse.updates','android:exported':'false','android:grantUriPermissions':'true'},'meta-data':[{$:{'android:name':'android.support.FILE_PROVIDER_PATHS','android:resource':'@xml/pulse_update_paths'}}]});
  return c;
 });
 config=withMainApplication(config,c=>{
  const marker='packages.add(PulseInstallerPackage())';
  if(!c.modResults.contents.includes(marker))c.modResults.contents=c.modResults.contents.replace(/(val packages = PackageList\(this\)\.packages)/,'$1').replace(/(PackageList\(this\)\.packages\.apply\s*\{)/,'$1\n          '+marker);
  if(!c.modResults.contents.includes(marker))throw Error('Expo MainApplication package hook changed');
  return c;
 });
 return withDangerousMod(config,['android',async c=>{
  const base=path.join(c.modRequest.platformProjectRoot,'app/src/main');const java=path.join(base,'java/com/pulse/work/mobile');
  fs.mkdirSync(java,{recursive:true});fs.copyFileSync(path.join(__dirname,'PulseInstaller.kt'),path.join(java,'PulseInstaller.kt'));
  fs.mkdirSync(path.join(base,'res/xml'),{recursive:true});fs.writeFileSync(path.join(base,'res/xml/pulse_update_paths.xml'),'<paths xmlns:android="http://schemas.android.com/apk/res/android"><cache-path name="pulse_updates" path="pulse-updates/" /></paths>');
  return c;
 }]);
};
