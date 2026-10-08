// Keep Widget and Notifee's WorkManager/Kotlin helpers on the same release.
const {withProjectBuildGradle}=require('expo/config-plugins');
module.exports=config=>withProjectBuildGradle(config,config=>{
 const marker='// Pulse WorkManager alignment';
 if(!config.modResults.contents.includes(marker))config.modResults.contents+=`\n${marker}\nsubprojects {\n  configurations.configureEach {\n    resolutionStrategy.eachDependency { details ->\n      if (details.requested.group == 'androidx.work') details.useVersion '2.8.1'\n    }\n  }\n}\n`;
 return config;
});
