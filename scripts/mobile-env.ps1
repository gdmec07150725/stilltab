# Dot-source this file in a PowerShell session; it changes only this process.
$env:FLUTTER_ROOT = 'D:\code\.tools\flutter'
$env:JAVA_HOME = 'D:\code\.tools\jdk\jdk-17.0.20.1+1'
$env:ANDROID_HOME = 'D:\code\.tools\android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:ANDROID_USER_HOME = 'D:\code\.cache\android-user'
$env:ANDROID_AVD_HOME = 'D:\code\.cache\android-avd'
$env:PUB_CACHE = 'D:\code\.cache\pub'
$env:GRADLE_USER_HOME = 'D:\code\.cache\gradle'
$env:TEMP = 'D:\code\.cache\mobile-temp'
$env:TMP = $env:TEMP
$env:APPDATA = 'D:\code\.cache\android-user\appdata'
$env:LOCALAPPDATA = 'D:\code\.cache\android-user\localappdata'
$env:FLUTTER_STORAGE_BASE_URL = 'https://storage.flutter-io.cn'
$env:PUB_HOSTED_URL = 'https://pub.flutter-io.cn'
$env:CI = 'true'
$env:FLUTTER_SUPPRESS_ANALYTICS = 'true'
$env:DART_SUPPRESS_ANALYTICS = 'true'
$env:Path = "$env:FLUTTER_ROOT\bin;$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:Path"
foreach ($taskPath in @($env:ANDROID_USER_HOME, $env:ANDROID_AVD_HOME, $env:PUB_CACHE, $env:GRADLE_USER_HOME, $env:TEMP, $env:APPDATA, $env:LOCALAPPDATA)) {
    New-Item -ItemType Directory -Force -Path $taskPath | Out-Null
}
