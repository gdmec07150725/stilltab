# Android 原生验证记录

日期：2026-10-14。范围：`apps/mobile/android/app/src/main` 原生执行层及 `src/test` 规则测试。

## 当前结论

- 纯 Kotlin/JVM 测试实际运行结果：**23 项通过，0 失败**。最后一次输出为 `OK (23 tests)`，JUnit 用时 0.625 秒，进程退出码 0。
- 前一轮使用真实 Android API 36 的原生类型检查通过，编译器退出码 0、没有编译错误。本次输入法窗口分类修复只运行 JVM 测试，未重新运行 API 类型检查或 Flutter/Gradle 构建。
- 本轮尚未执行完整 Gradle/Flutter Android 构建。API 类型检查不包含生产 `MainActivity.kt` 的 Flutter 桥接；不能据此声称 APK 已构建或已安装。
- 本轮尚未执行手机或模拟器上的授权、前台切换、遮罩、锁屏、权限撤销、系统文件选择器等交互验收。
- 没有初始化 Git、提交、发布或自动开启无障碍服务。

## 已实现的原生文件

- `RuleEngine.kt`：严格 Map 校验、规则模型、时段/跨午夜判断、冲突排序、例外、额度、单条临时放行、分钟及午夜分段计时、八天用量保留、前台会话与窗口分类、双时钟采样。
- `StrictJson.kt`：独立于 Android 的严格 JSON 读取，拒绝重复字段、尾随内容、非 JSON 数值、非法语法、过深嵌套及超过 2 MiB 的配置。
- `RuleStore.kt`：单个 SharedPreferences 快照原子替换配置，持久化规则/用量/放行/等待截止时间/最多 300 条记录；导入重置执行状态，普通编辑保留用量。
- `AppPolicy.kt`：实际已安装可启动应用列表；排除自身、桌面、设置、拨号/通话、输入法及系统权限组件。
- `RuleOverlay.kt`：非全屏提醒、等待倒计时、全屏拦截；自定义文案，返回桌面及管理规则入口。
- `RuleService.kt`：独立于 Flutter 存活的无障碍服务；仅使用事件包名、窗口类名及全屏标记，不访问节点、事件文字或页面内容。自身遮罩与键盘不清除确认；系统临时窗口暂停监测；锁屏停止 ticker，解锁及后续真实前台事件恢复采样。
- `MainActivity.kt`：`behavior_rules/platform` 通道全部 Android 方法；实时状态；SAF 文件选择/保存；读取严格 UTF-8 且流式限制 2 MiB。
- `AndroidManifest.xml`、`res/xml/behavior_accessibility_service.xml`、`res/values/behavior_strings.xml`：服务声明、用户用途说明、可见应用查询；内容检索和手势能力均关闭。
- `src/test/kotlin/com/behaviorrules/mobile/RuleEngineTest.kt`：23 项 JVM 测试。

## 测试覆盖与红绿证据

前 18 项测试先于生产引擎写入，但当时 Flutter/Gradle/JDK 工具链尚未就绪，首次 RED 未能运行。因此不声称这 18 项完成了实际红绿验证。工具链具备后，它们经真正编译和 JUnit 执行通过。

此前 3 项回归实际观察到失败，随后修复并运行当时完整的 21 项套件通过：

| 回归 | 修复前证据 | 修复后行为 |
| --- | --- | --- |
| `retentionKeepsTodayAndSevenEarlierDaysOnly` | 第九天未被排除，`assertFalse` 失败 | 今天及前七天保留；更早、未来和非法日期排除 |
| `smallWallClockAdjustmentDoesNotInflateMonotonicUsage` | elapsed 1000 ms、wall 2000 ms，实际记入 2000 ms | 按 elapsed 时长累计，区间映射到当前 wall 时间；大幅时钟跳变丢弃采样 |
| `timestampsRemainInsideFlutterDateTimeRange` | 8640000000000001 没有抛出异常 | `createdAt` 为 0..8640000000000000；接受数学整数 1.0，拒绝小数和越界 |

其余覆盖包括：开始包含/结束不含、指定星期、跨午夜按开始日归属、相同起止时间全天、动作/优先级/创建时间/ID 冲突顺序、例外与停用规则、额度毫秒边界、grant 精确到期、单条放行不屏蔽其他规则、确认不屏蔽其他规则、午夜分日、有效时段分段计时、同一访问确认保留/真实离开清除、服务重启及长暂停不补计、明显时钟跳变、严格 JSON 语法、中文/转义、未知动作/非整数/重复目标、平台/重复 ID/缺失字段/超大配置、布尔类型/非法星期/受保护目标。

计时裁定：只累计启用规则的有效时段内、排除例外后的目标应用组前台使用；提醒和临时放行期间继续累计，等待/拦截遮罩、锁屏、系统临时窗口暂停期间不累计。


### 输入法完整 Activity 回归修复

独立审查发现，输入法包此前同时被 `imePackages` 直接忽略，并包含在 `AppPolicy.transientPackages` 中。输入法自己的完整设置 Activity 因而没有结束前一个目标应用的访问，可能继续累计前一应用用时。

将原有窗口分类提取为生产使用的纯 Kotlin `ForegroundSession.onWindow`，由 `RuleService` 消费分类结果。先保持旧逻辑运行测试，`imeSettingsActivityEndsPriorVisitAndStopsItsUsage` 确实失败：期望 `CHANGED`，实际为 `IGNORED`。随后修复两个过滤分支：仅非 Activity 的输入法窗口作为键盘忽略；输入法完整 Activity 跳过临时窗口暂停分支，进入新会话，清除旧确认/等待及遮罩。输入法包仍属于 `blockedPackages`，所以完整 Activity 不累计目标规则用量，也不显示干预。

新增两项检查使用真实生产会话及计时引擎：

- `imeSettingsActivityEndsPriorVisitAndStopsItsUsage`：切入输入法设置 Activity 后，包名变化、旧确认清除，原目标应用已经累计的 1000 ms 在后续 5000 ms 中不再增加。此项已实际 RED→GREEN。
- `keyboardPopupPreservesPriorVisitAndAcknowledgement`：普通输入法窗口仍保持原目标包名和本次确认，不误判为新访问。

修复后运行 `D:/code/.cache/mobile-kotlin-tests/run-tests.ps1`，完整套件 `OK (23 tests)`、退出码 0。本次没有运行 Flutter/Gradle 重构建，系统是否正确识别各厂商输入法 Activity 仍需实际设备验收。

## 可复现的 JVM 测试命令

工具和产物均位于 D 盘：

- JDK：`D:/code/.tools/jdk/jdk-17.0.20.1+1`
- Android SDK：`D:/code/.tools/android-sdk`，API 36
- Kotlin 编译器：2.2.10，`D:/code/.cache/mobile-kotlin-tests/kotlin-compiler-embeddable-2.2.10.jar`
- JUnit：4.13.2；Hamcrest：1.3
- 编译产物：`D:/code/.cache/mobile-kotlin-tests/classes`
- 实际执行脚本：`D:/code/.cache/mobile-kotlin-tests/run-tests.ps1`

```powershell
Set-Location 'D:/code/behavior-rules/apps/mobile'
& 'D:/code/.cache/mobile-kotlin-tests/run-tests.ps1'
```

脚本使用 `org.jetbrains.kotlin.cli.jvm.K2JVMCompiler` 编译生产 `RuleEngine.kt`、`StrictJson.kt` 及真实 `RuleEngineTest.kt`，随后使用 `org.junit.runner.JUnitCore com.behaviorrules.mobile.RuleEngineTest` 执行。编译器限制 `-Xms32m -Xmx384m -XX:+UseSerialGC`，测试 JVM 限制 `-Xms16m -Xmx128m -XX:+UseSerialGC`。

第一次使用默认 JVM 内存时发生 Windows 分页文件不足（errno 1455），限制内存后恢复；该次失败不算产品测试结果。SDK 自带 Lint Kotlin 编译器缺少后端类，未采用其结果；后续使用下列官方 Maven 分发。

依赖来源：

- [Kotlin compiler 2.2.10](https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-compiler-embeddable/2.2.10/kotlin-compiler-embeddable-2.2.10.jar)
- [Kotlin script runtime 2.2.10](https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-script-runtime/2.2.10/kotlin-script-runtime-2.2.10.jar)
- [JUnit 4.13.2](https://repo.maven.apache.org/maven2/junit/junit/4.13.2/junit-4.13.2.jar)
- [Hamcrest 1.3](https://repo.maven.apache.org/maven2/org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar)

Kotlin stdlib/reflect 2.2.10、coroutines 1.10.2 与 annotations 23.0.0 使用本机 Android SDK command-line-tools 中已存在的官方依赖。

## API 36 编译检查的准确界限

同一个 Kotlin 编译器使用 `android-36/android.jar` 和 Kotlin stdlib 作为 classpath，编译 `main/kotlin/com/behaviorrules/mobile` 的全部 `.kt`，但排除生产 `MainActivity.kt`。

仅为满足 `RuleService` 启动管理界面的类型引用，在缓存目录创建了 `ActivityTypeForCompile.kt`（`class MainActivity : android.app.Activity()`）。这个类型只是编译检查符号，不在应用源码内，不参与 APK，不冒充 Flutter 的生产入口。输出在 `D:/code/.cache/mobile-kotlin-tests/android-api-check`。

这项检查证明服务、遮罩、应用查询、SharedPreferences、引擎等源码可对 Android API 36 完成类型检查，**不证明 Flutter embedding、资源合并、manifest 合并、Gradle 插件、APK 打包或 Android 运行时行为正确**。

完整工程具备后需补跑（以下尚未由本轮执行）：

```powershell
. 'D:/code/behavior-rules/scripts/mobile-env.ps1'
Set-Location 'D:/code/behavior-rules/apps/mobile/android'
.\gradlew.bat :app:testDebugUnitTest --no-daemon --max-workers=2
Set-Location '..'
flutter build apk --debug
```

## 仍需设备验收的边界

- 不同厂商是否对权限弹窗、通知面板、最近任务、桌面和电话发出预期的窗口包名事件。
- 服务重连、解锁或系统临时窗口关闭后，恢复依赖后续 `TYPE_WINDOW_STATE_CHANGED`；没有该事件时恢复可能延迟。没有根据未知前台状态补记用时。
- 提醒卡片可在外部继续操作；全屏等待/拦截保留系统导航与管理规则出口。大字体、长文案和各尺寸实际布局需设备检查。
- 权限撤销、系统杀进程、厂商省电策略、画中画及分屏行为。
- SAF 导入/导出取消、外部文档提供器和进程重建场景。
- 本工具只提供可自行关闭的行为辅助；返回桌面使用 `GLOBAL_ACTION_HOME`，不结束目标进程，不阻止卸载。

## 官方 API 参考

- [AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService)
- [AccessibilityWindowInfo](https://developer.android.com/reference/android/view/accessibility/AccessibilityWindowInfo)
- [Storage Access Framework 文档选择与保存](https://developer.android.com/training/data-storage/shared/documents-files)

本轮问题是确定性类型、边界和状态处理，没有调用 Jev；不声称存在 Jev 审查结果。
