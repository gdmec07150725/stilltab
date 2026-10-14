# Flutter 界面与模型验证

2026-10-14，工具链 Flutter 3.47.7 / Dart 3.13.5，项目 `D:/code/behavior-rules/apps/mobile`。

实际执行结果：

```text
flutter analyze
No issues found! (exit 0)

flutter test --concurrency=1 --reporter expanded
All tests passed! 17/17 (exit 0)
```

9 项模型测试覆盖规则、平台与能力校验，数学整数（接受 1.0、拒绝真正小数）、时间戳和数量边界、UTF-8 大小限制、重复目标/例外、导入跨平台与 iOS 未实现能力拒绝。

8 项 widget 测试覆盖默认停用规则、实际选择应用后的保存、保存失败保留输入、编辑期间刷新、小屏与大字体、导入预览/取消/确认/错误平台、预览等待按钮的倒计时、iOS 能力提示。

模型整数校验与预览倒计时曾真实出现失败，修复后整套通过。导入测试曾因等待持续进度动画而超时，改为等待对话框转场再操作；最终结果不包含跳过或静默忽略的失败。

测试注入的假平台实现仅存在 `test/`，发行代码使用 `behavior_rules/platform` MethodChannel。此结果验证模型和 Flutter 交互，不证明 Android 无障碍授权、实际遮罩、前台识别、后台存活、厂商省电行为或 iOS Screen Time API 正确；这些必须由平台构建和设备验收分别证明。

复现：

```powershell
. 'D:/code/behavior-rules/scripts/mobile-env.ps1'
Set-Location 'D:/code/behavior-rules/apps/mobile'
flutter analyze
flutter test --concurrency=1 --reporter expanded
```