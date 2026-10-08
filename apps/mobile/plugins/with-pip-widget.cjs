// Add the existing Pip artwork to the widget extension's resource bundle; no signing material.
const {withXcodeProject} = require('expo/config-plugins');
const fs = require('node:fs');const path=require('node:path');
module.exports=config=>withXcodeProject(config,config=>{
 const project=config.modResults;const targetName='ExpoWidgetsTarget';
 const targets=project.pbxNativeTargetSection();
 const target=Object.entries(targets).find(([id,t])=>!id.endsWith('_comment')&&t.name?.replaceAll('"','')===targetName);
 if(!target)throw Error('Pulse iOS widget target is missing');
 // ActivityKit rejects oversized images even with resizable(); preserve point size with 1x/2x/3x variants.
 // https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
 const relative=`${targetName}/Pip.xcassets`;
 for(const [name,points] of [['Pip',48],['PipIsland',26]]){
  const dir=path.join(config.modRequest.platformProjectRoot,relative,`${name}.imageset`);
  fs.mkdirSync(dir,{recursive:true});
  const images=[1,2,3].map(scale=>{
   const filename=`pip-${points}@${scale}x.png`;
   fs.copyFileSync(path.join(config.modRequest.projectRoot,'assets',filename),path.join(dir,filename));
   return {filename,idiom:'universal',scale:`${scale}x`};
  });
  fs.writeFileSync(path.join(dir,'Contents.json'),JSON.stringify({images,info:{author:'xcode',version:1}}));
 }
 const group=project.findPBXGroupKey({name:targetName});
 if(!group)throw Error('Pulse widget resource group is missing');
 // expo-widgets creates Sources/Frameworks but no Resources phase. Without one,
 // node-xcode falls back to the main app's Resources phase and Pip disappears.
 if(!target[1].buildPhases.some(p=>p.comment==='Resources'))
  project.addBuildPhase([],'PBXResourcesBuildPhase','Resources',target[0]);
 const file=project.addFile('Pip.xcassets',group);
 if(file){file.uuid=project.generateUuid();file.target=target[0];project.addToPbxBuildFileSection(file);project.addToPbxResourcesBuildPhase(file);}
 return config;
});
