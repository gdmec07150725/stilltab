# 行为规则 Flutter App

源码与开发工具位于 `D:/code/behavior-rules` 和 `D:/code/.tools`。当前 Android 包标识为 `com.behaviorrules.mobile`，最低 Android 8.0（API 26），本地体验包使用调试签名。

从项目根目录运行：

```powershell
./scripts/build-mobile.ps1
```

脚本会加载 D 盘工具链，执行 Flutter 静态分析、模型/界面测试、ARM64 APK 构建和原生 JVM 测试，再保存到 `releases/mobile/1.0.0`。不使用 `-SkipChecks` 时才执行完整检查。不要把调试包当作商店正式发布包。

产品说明：`../../docs/mobile/设计.md`。
一加 15 / ColorOS 16 体验：`../../docs/mobile/一加15安装与体验.md`。
原生协议：`../../docs/mobile/平台接口.md`。
iOS 能力与 Mac 配置：`../../docs/mobile/平台能力.md`。

Android 无障碍服务独立执行规则，Flutter 负责配置。服务不访问无障碍节点或文本，不采集键盘输入。真正的授权、遮罩、后台存活及锁屏行为需要在手机验证；widget 和 JVM 测试不能替代这些验收。