const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
test('Android package registration uses the apply receiver, while permission and provider stay scoped to the APK cache',()=>{
 const hooks={};const api={withMainApplication:(config,cb)=>{hooks.main=cb;return config;},withAndroidManifest:(config,cb)=>{hooks.manifest=cb;return config;},withDangerousMod:config=>config};
 const module={exports:{}};const source=fs.readFileSync(path.resolve(__dirname,'../plugins/with-updater.cjs'),'utf8');
 vm.runInNewContext(source,{module,exports:module.exports,require:n=>n==='expo/config-plugins'?api:require(n)});module.exports({});
 const contents='val packages = PackageList(this).packages.apply {\n // Register native packages here\n}';
 const output=hooks.main({modResults:{contents}}).modResults.contents;
 assert.match(output,/\.apply\s*\{\s*add\(PulseInstallerPackage\(\)\)/);assert.doesNotMatch(output,/packages\.add/);
 assert.equal(hooks.main({modResults:{contents:output}}).modResults.contents,output,'idempotent prebuild');
 const manifest={modResults:{manifest:{application:[{}]}}};hooks.manifest(manifest);hooks.manifest(manifest);
 const providers=manifest.modResults.manifest.application[0].provider;assert.equal(providers.length,1);assert.equal(providers[0].$['android:authorities'],'${applicationId}.pulse.updates');assert.equal(providers[0].$['android:exported'],'false');
});
