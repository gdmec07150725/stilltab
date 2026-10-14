#!/usr/bin/env node
// Reapply or inspect the native iOS wiring without invoking Xcode.
// Dependency: npm install --prefix work/ios-project-tools xcode@3.0.1
// Usage: node scripts/configure-ios.cjs [--check]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const xcode = require(path.join(root, 'work/ios-project-tools/node_modules/xcode'));
const ios = path.join(root, 'apps/mobile/ios');
const projectPath = path.join(ios, 'Runner.xcodeproj/project.pbxproj');
const reportPath = path.join(root, 'work/ios-project-check.json');
const extensions = ['BehaviorMonitor', 'BehaviorShield', 'BehaviorShieldAction'];
const names = ['Debug', 'Release', 'Profile'];
const q = value => JSON.stringify(value);
const clean = value => typeof value === 'string' && value.startsWith('"') ? JSON.parse(value) : String(value);
const id = label => crypto.createHash('sha256').update('behavior-rules-ios:' + label).digest('hex').slice(0, 24).toUpperCase();
const ref = (value, comment) => ({value, comment});
function load() { const p = xcode.project(projectPath); p.parseSync(); return p; }
function entries(section) { return Object.entries(section || {}).filter(([key]) => !key.endsWith('_comment')); }
function configure(p) {
  const o = p.hash.project.objects;
  function put(section, key, object, comment) {
    o[section] ||= {}; o[section][key] = {isa: section, ...object};
    o[section][key + '_comment'] = comment;
    return key;
  }
  function push(list, value, comment) { if (!list.some(item => item.value === value)) list.push(ref(value, comment)); }
  const [projectID, project] = entries(o.PBXProject)[0];
  const [runnerID, runner] = entries(o.PBXNativeTarget).find(([,target]) => clean(target.name) === 'Runner');
  const mainGroup = o.PBXGroup[project.mainGroup];
  const products = o.PBXGroup[project.productRefGroup];
  const runnerGroupID = entries(o.PBXGroup).find(([,g]) => clean(g.path) === 'Runner')[0];
  function group(name) {
    if (name === 'Runner') return runnerGroupID;
    const key = id('group:' + name);
    if (!o.PBXGroup[key]) put('PBXGroup', key, {children: [], path: name, sourceTree: q('<group>')}, name);
    push(mainGroup.children, key, name);
    return key;
  }
  function file(name, relativePath, type) {
    const key = id('file:' + relativePath);
    put('PBXFileReference', key, {lastKnownFileType: type, path: q(path.posix.basename(relativePath)), sourceTree: q('<group>')}, path.posix.basename(relativePath));
    push(o.PBXGroup[group(name)].children, key, path.posix.basename(relativePath));
    return key;
  }
  function source(targetName, phase, relativePath) {
    const name = path.posix.dirname(relativePath), filename = path.posix.basename(relativePath);
    const fileID = file(name, relativePath, 'sourcecode.swift');
    const buildID = id('source:' + targetName + ':' + relativePath);
    put('PBXBuildFile', buildID, {fileRef: fileID, fileRef_comment: filename}, filename + ' in Sources');
    push(phase.files, buildID, filename + ' in Sources');
  }
  const runnerSources = runner.buildPhases.map(r => o.PBXSourcesBuildPhase[r.value]).find(Boolean);
  source('Runner', runnerSources, 'Runner/BehaviorPlatform.swift');
  source('Runner', runnerSources, 'Shared/BehaviorStore.swift');
  file('Runner', 'Runner/Runner.entitlements', 'text.plist.entitlements');
  const configs = target => o.XCConfigurationList[target.buildConfigurationList].buildConfigurations.map(r => o.XCBuildConfiguration[r.value]);
  // All targets, including tests and inherited project configurations, share iOS 16.
  for (const [,config] of entries(o.XCBuildConfiguration)) config.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '16.0';
  for (const config of configs(runner)) Object.assign(config.buildSettings, {
    CODE_SIGN_ENTITLEMENTS: 'Runner/Runner.entitlements', CODE_SIGN_STYLE: 'Automatic',
    PRODUCT_BUNDLE_IDENTIFIER: 'com.behaviorrules.mobile', IPHONEOS_DEPLOYMENT_TARGET: '16.0',
  });
  const embedID = id('embed-extensions');
  put('PBXCopyFilesBuildPhase', embedID, {buildActionMask: 2147483647, dstPath: q(''), dstSubfolderSpec: 13,
    files: [], name: q('Embed App Extensions'), runOnlyForDeploymentPostprocessing: 0}, 'Embed App Extensions');
  // Keep embed ahead of Flutter's final thinning script.
  runner.buildPhases = runner.buildPhases.filter(r => r.value !== embedID);
  const thinIndex = runner.buildPhases.findIndex(r => clean(o.PBXShellScriptBuildPhase?.[r.value]?.name) === 'Thin Binary');
  runner.buildPhases.splice(thinIndex < 0 ? runner.buildPhases.length : thinIndex, 0, ref(embedID, 'Embed App Extensions'));
  project.attributes.TargetAttributes ||= {};
  const capabilities = () => ({'com.apple.ApplicationGroups.iOS': {enabled: 1}, 'com.apple.FamilyControls': {enabled: 1}});
  Object.assign(project.attributes.TargetAttributes[runnerID], {SystemCapabilities: capabilities()});
  for (const name of extensions) {
    const targetID = id('target:' + name), productID = id('product:' + name);
    const sourceID = id('sources:' + name), frameworkID = id('frameworks:' + name), resourceID = id('resources:' + name);
    const listID = id('config-list:' + name);
    put('PBXFileReference', productID, {explicitFileType: 'wrapper.app-extension', includeInIndex: 0, path: name + '.appex', sourceTree: 'BUILT_PRODUCTS_DIR'}, name + '.appex');
    push(products.children, productID, name + '.appex');
    const sourcePhase = {buildActionMask: 2147483647, files: [], runOnlyForDeploymentPostprocessing: 0};
    put('PBXSourcesBuildPhase', sourceID, sourcePhase, 'Sources');
    put('PBXFrameworksBuildPhase', frameworkID, {...sourcePhase, files: []}, 'Frameworks');
    put('PBXResourcesBuildPhase', resourceID, {...sourcePhase, files: []}, 'Resources');
    source(name, o.PBXSourcesBuildPhase[sourceID], name + '/' + name + '.swift');
    if (name !== 'BehaviorShieldAction') source(name, o.PBXSourcesBuildPhase[sourceID], 'Shared/BehaviorStore.swift');
    file(name, name + '/Info.plist', 'text.plist.xml');
    file(name, name + '/' + name + '.entitlements', 'text.plist.entitlements');
    const buildConfigurations = names.map(configuration => {
      const configID = id('config:' + name + ':' + configuration);
      put('XCBuildConfiguration', configID, {buildSettings: {
        ...o.XCBuildConfiguration?.[configID]?.buildSettings,
        APPLICATION_EXTENSION_API_ONLY: 'YES', CLANG_ENABLE_MODULES: 'YES', CODE_SIGN_STYLE: 'Automatic',
        CODE_SIGN_ENTITLEMENTS: name + '/' + name + '.entitlements', CURRENT_PROJECT_VERSION: 1,
        GENERATE_INFOPLIST_FILE: 'NO', INFOPLIST_FILE: name + '/Info.plist', IPHONEOS_DEPLOYMENT_TARGET: '16.0',
        LD_RUNPATH_SEARCH_PATHS: [q('$(inherited)'), q('@executable_path/Frameworks'), q('@executable_path/../../Frameworks')],
        MARKETING_VERSION: '1.0.0', PRODUCT_BUNDLE_IDENTIFIER: 'com.behaviorrules.mobile.' + name,
        PRODUCT_NAME: q('$(TARGET_NAME)'), SDKROOT: 'iphoneos', SKIP_INSTALL: 'YES',
        SUPPORTED_PLATFORMS: q('iphoneos iphonesimulator'), SWIFT_VERSION: '5.0', TARGETED_DEVICE_FAMILY: q('1,2'),
        SWIFT_OPTIMIZATION_LEVEL: q(configuration === 'Debug' ? '-Onone' : '-O'),
        ...(configuration === 'Debug' ? {SWIFT_ACTIVE_COMPILATION_CONDITIONS: q('DEBUG $(inherited)')} : {SWIFT_COMPILATION_MODE: 'wholemodule'}),
      }, name: configuration}, configuration);
      return ref(configID, configuration);
    });
    put('XCConfigurationList', listID, {buildConfigurations, defaultConfigurationIsVisible: 0, defaultConfigurationName: 'Release'}, 'Build configuration list for PBXNativeTarget "' + name + '"');
    put('PBXNativeTarget', targetID, {buildConfigurationList: listID, buildConfigurationList_comment: 'Build configuration list for PBXNativeTarget "' + name + '"',
      buildPhases: [ref(sourceID, 'Sources'), ref(frameworkID, 'Frameworks'), ref(resourceID, 'Resources')],
      buildRules: [], dependencies: [], name, productName: name, productReference: productID, productReference_comment: name + '.appex',
      productType: q('com.apple.product-type.app-extension')}, name);
    push(project.targets, targetID, name);
    project.attributes.TargetAttributes[targetID] = {...project.attributes.TargetAttributes[targetID], CreatedOnToolsVersion: '16.0', ProvisioningStyle: 'Automatic', SystemCapabilities: capabilities()};
    const proxyID = id('proxy:' + name), dependencyID = id('dependency:' + name);
    put('PBXContainerItemProxy', proxyID, {containerPortal: projectID, containerPortal_comment: 'Project object', proxyType: 1, remoteGlobalIDString: targetID, remoteInfo: name}, 'PBXContainerItemProxy');
    put('PBXTargetDependency', dependencyID, {target: targetID, target_comment: name, targetProxy: proxyID, targetProxy_comment: 'PBXContainerItemProxy'}, 'PBXTargetDependency');
    push(runner.dependencies, dependencyID, 'PBXTargetDependency');
    const embedFileID = id('embed:' + name);
    put('PBXBuildFile', embedFileID, {fileRef: productID, fileRef_comment: name + '.appex', settings: {ATTRIBUTES: ['RemoveHeadersOnCopy']}}, name + '.appex in Embed App Extensions');
    push(o.PBXCopyFilesBuildPhase[embedID].files, embedFileID, name + '.appex in Embed App Extensions');
  }
  fs.writeFileSync(projectPath, p.writeSync());
  const frameworkPath = path.join(ios, 'Flutter/AppFrameworkInfo.plist');
  let plist = fs.readFileSync(frameworkPath, 'utf8');
  if (/<key>MinimumOSVersion<\/key>/.test(plist)) plist = plist.replace(/(<key>MinimumOSVersion<\/key>\s*<string>)[^<]+/, (_, prefix) => prefix + '16.0');
  else plist = plist.replace('</dict>', '  <key>MinimumOSVersion</key>\n  <string>16.0</string>\n</dict>');
  fs.writeFileSync(frameworkPath, plist);
}
function verify(p) {
  const o = p.hash.project.objects, project = entries(o.PBXProject)[0][1];
  const targets = Object.fromEntries(entries(o.PBXNativeTarget).map(([key, value]) => [clean(value.name), {key, ...value}]));
  const expectedSources = {
    Runner: ['Runner/AppDelegate.swift', 'Runner/SceneDelegate.swift', 'Runner/GeneratedPluginRegistrant.m', 'Runner/BehaviorPlatform.swift', 'Shared/BehaviorStore.swift'],
    BehaviorMonitor: ['BehaviorMonitor/BehaviorMonitor.swift', 'Shared/BehaviorStore.swift'],
    BehaviorShield: ['BehaviorShield/BehaviorShield.swift', 'Shared/BehaviorStore.swift'],
    BehaviorShieldAction: ['BehaviorShieldAction/BehaviorShieldAction.swift'],
  };
  const filePaths = {};
  function walk(groupID, prefix = '') {
    const group = o.PBXGroup[groupID] || o.PBXVariantGroup?.[groupID];
    assert(group, 'Missing group ' + groupID);
    const base = group.path ? path.posix.join(prefix, clean(group.path)) : prefix;
    for (const child of group.children) {
      if (o.PBXGroup[child.value] || o.PBXVariantGroup?.[child.value]) walk(child.value, base);
      else {
        const file = o.PBXFileReference[child.value];
        assert(file, 'Missing file reference ' + child.value);
        if (clean(file.sourceTree) !== 'BUILT_PRODUCTS_DIR') filePaths[child.value] = path.posix.join(base, clean(file.path));
      }
    }
  }
  walk(project.mainGroup);
  const results = [];
  for (const [name, expected] of Object.entries(expectedSources)) {
    const target = targets[name]; assert(target, 'Missing target ' + name);
    assert(project.targets.some(r => r.value === target.key), 'Target absent from project: ' + name);
    const configs = o.XCConfigurationList[target.buildConfigurationList].buildConfigurations.map(r => o.XCBuildConfiguration[r.value]);
    assert.deepEqual(configs.map(c => clean(c.name)).sort(), [...names].sort(), name + ' configurations');
    for (const config of configs) {
      const settings = config.buildSettings;
      assert.equal(clean(settings.IPHONEOS_DEPLOYMENT_TARGET), '16.0');
      assert.equal(clean(settings.PRODUCT_BUNDLE_IDENTIFIER), 'com.behaviorrules.mobile' + (name === 'Runner' ? '' : '.' + name));
      assert.equal(clean(settings.CODE_SIGN_ENTITLEMENTS), name + '/' + name + '.entitlements');
      assert.equal(clean(settings.INFOPLIST_FILE), name + '/Info.plist');
      for (const setting of ['CODE_SIGN_ENTITLEMENTS', 'INFOPLIST_FILE']) assert(fs.existsSync(path.join(ios, clean(settings[setting]))), name + ' missing ' + setting);
      if (name !== 'Runner') { assert.equal(settings.APPLICATION_EXTENSION_API_ONLY, 'YES'); assert.equal(settings.SKIP_INSTALL, 'YES'); }
    }
    const sourcePhases = target.buildPhases.map(r => o.PBXSourcesBuildPhase[r.value]).filter(Boolean);
    const sources = sourcePhases.flatMap(phase => phase.files.map(r => filePaths[o.PBXBuildFile[r.value].fileRef]));
    assert.deepEqual([...sources].sort(), [...expected].sort(), name + ' source membership');
    for (const source of sources) assert(fs.existsSync(path.join(ios, source)), 'Missing source ' + source);
    const entitlement = fs.readFileSync(path.join(ios, name + '/' + name + '.entitlements'), 'utf8');
    assert(entitlement.includes('group.com.behaviorrules.mobile') && entitlement.includes('com.apple.developer.family-controls'), name + ' capabilities');
    if (name !== 'Runner') assert.equal(clean(target.productType), 'com.apple.product-type.app-extension');
    results.push({name, configurations: configs.map(c => clean(c.name)), deploymentTarget: '16.0', sources, entitlements: name + '/' + name + '.entitlements', bundleIdentifier: clean(configs[0].buildSettings.PRODUCT_BUNDLE_IDENTIFIER)});
  }
  const runner = targets.Runner;
  const dependencyTargets = runner.dependencies.map(r => o.PBXTargetDependency[r.value].target);
  for (const name of extensions) assert(dependencyTargets.includes(targets[name].key), 'Missing Runner dependency ' + name);
  const embed = runner.buildPhases.map(r => o.PBXCopyFilesBuildPhase[r.value]).filter(Boolean).find(phase => clean(phase.name) === 'Embed App Extensions');
  assert(embed && Number(embed.dstSubfolderSpec) === 13, 'Missing PlugIns embedding phase');
  const embedded = embed.files.map(r => o.PBXBuildFile[r.value].fileRef);
  assert.deepEqual([...embedded].sort(), extensions.map(name => targets[name].productReference).sort());
  for (const r of embed.files) assert(o.PBXBuildFile[r.value].settings.ATTRIBUTES.includes('RemoveHeadersOnCopy'));
  for (const [,config] of entries(o.XCBuildConfiguration)) assert.equal(clean(config.buildSettings.IPHONEOS_DEPLOYMENT_TARGET), '16.0');
  assert(/<key>MinimumOSVersion<\/key>\s*<string>16\.0<\/string>/.test(fs.readFileSync(path.join(ios, 'Flutter/AppFrameworkInfo.plist'), 'utf8')));
  const report = {checkedAt: new Date().toISOString(), passed: true, checkType: 'Xcode project parse and wiring only', xcodeBuildRun: false,
    limitations: ['Windows host has no Xcode; Swift compilation, signing, provisioning and iPhone execution are not verified.', 'Choose an Apple development team and provision Family Controls and the shared App Group on a Mac.'],
    project: 'apps/mobile/ios/Runner.xcodeproj/project.pbxproj', projectSha256: crypto.createHash('sha256').update(fs.readFileSync(projectPath)).digest('hex'),
    targets: results, runnerDependencies: extensions, embeddedExtensions: extensions.map(name => name + '.appex'), allSourcesExist: true};
  fs.mkdirSync(path.dirname(reportPath), {recursive: true});
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({passed: true, targets: results.length, configurations: names, embeddedExtensions: extensions.length, report: reportPath, xcodeBuildRun: false}, null, 2));
}
if (!process.argv.includes('--check')) configure(load());
verify(load());
