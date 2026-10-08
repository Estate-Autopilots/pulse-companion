const {withAppBuildGradle}=require('expo/config-plugins');
module.exports=config=>withAppBuildGradle(config,c=>{
 const marker='// Pulse durable release signing';
 if(!c.modResults.contents.includes(marker))c.modResults.contents+=`\n${marker}\nif (System.getenv("PULSE_ANDROID_KEYSTORE")) {\n  android.signingConfigs.create("pulseRelease") {\n    storeFile file(System.getenv("PULSE_ANDROID_KEYSTORE"))\n    storeType "PKCS12"\n    storePassword System.getenv("PULSE_ANDROID_KEY_PASSWORD")\n    keyAlias "pulse"\n    keyPassword System.getenv("PULSE_ANDROID_KEY_PASSWORD")\n  }\n  android.buildTypes.release.signingConfig = android.signingConfigs.pulseRelease\n}\n`;
 return c;
});
