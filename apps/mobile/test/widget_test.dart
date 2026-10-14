import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:behavior_rules_mobile/main.dart';
import 'package:behavior_rules_mobile/models.dart';
import 'package:behavior_rules_mobile/platform_bridge.dart';
import 'model_test.dart' show fixtureRule, configText;

class FakeBridge implements PlatformBridge {
  List<BehaviorRule> rules = [];
  int reads = 0, imports = 0, settingsOpened = 0;
  bool failSave = false;
  String? importText;
  String platform = 'android';
  Map<String, bool> capabilities = {
    for (final key in [
      'appSelection',
      'remind',
      'delay',
      'block',
      'schedules',
      'quotas',
      'exceptions',
    ])
      key: true,
  };
  AppState snapshot() => AppState.fromJson({
    'config': {
      'version': 1,
      'platform': platform,
      'rules': rules.map((r) => r.toJson()).toList(),
    },
    'usage': <String, dynamic>{},
    'grants': <String, dynamic>{},
    'logs': [],
    'today': '2026-10-14',
    'now': 1791936000000,
    'status': {
      'platform': platform,
      'permissionGranted': false,
      'monitoring': false,
      'availability': 'permissionRequired',
      'message': '测试设备尚未授权',
      'batteryOptimized': true,
      'lastEventAt': 0,
      'capabilities': capabilities,
    },
  });
  @override
  Future<AppState> getState() async {
    reads++;
    return snapshot();
  }

  @override
  Future<List<AppTarget>> listApps() async => const [
    AppTarget(platform: 'android', id: 'com.example.app', label: '示例应用'),
  ];
  @override
  Future<List<AppTarget>?> pickTargets({String? selectionId}) async => const [
    AppTarget(platform: 'ios', id: 'opaque_system_selection', label: '已选应用集合'),
  ];
  @override
  Future<AppState> saveRule(BehaviorRule rule) async {
    if (failSave) throw PlatformException(code: 'io', message: '保存失败，请重试');
    rules.removeWhere((r) => r.id == rule.id);
    rules.add(rule);
    return snapshot();
  }

  @override
  Future<AppState> deleteRule(String id) async {
    rules.removeWhere((r) => r.id == id);
    return snapshot();
  }

  @override
  Future<AppState> toggleRule(String id, bool enabled) async {
    rules = rules
        .map(
          (r) => r.id == id
              ? BehaviorRule.fromJson({
                  ...r.toJson(),
                  'enabled': enabled,
                }, platform: platform)
              : r,
        )
        .toList();
    return snapshot();
  }

  @override
  Future<AppState> bypassRule(String id) async => snapshot();
  @override
  Future<AppState> revokeBypass(String id) async => snapshot();
  @override
  Future<AppState> clearLogs() async => snapshot();
  @override
  Future<String> getConfigJson() async =>
      jsonEncode(snapshot().config.toJson());
  @override
  Future<String?> exportConfig() async => '已导出';
  @override
  Future<String?> readImportFile() async => importText;
  @override
  Future<AppState> importConfig(String json) async {
    imports++;
    rules = RuleConfig.parse(json, expectedPlatform: platform).rules;
    return snapshot();
  }

  @override
  Future<void> openAccessibilitySettings() async {
    settingsOpened++;
  }

  @override
  Future<void> openAppSettings() async {}
  @override
  Future<void> openBatterySettings() async {}
  @override
  Future<PlatformStatus> requestAuthorization() async => snapshot().status;
}

Future<void> openEditor(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('add-rule')));
  await tester.pumpAndSettle();
}

Future<void> chooseApp(WidgetTester tester) async {
  await tester.ensureVisible(find.byKey(const Key('choose-targets')));
  await tester.tap(find.byKey(const Key('choose-targets')));
  await tester.pumpAndSettle();
  await tester.tap(find.text('示例应用'));
  await tester.pump();
  await tester.tap(find.byKey(const Key('confirm-targets')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('new rules start disabled and save actual selected apps', (
    tester,
  ) async {
    final bridge = FakeBridge();
    await tester.pumpWidget(BehaviorRulesApp(bridge: bridge));
    await tester.pumpAndSettle();
    expect(find.text('尚未授权'), findsWidgets);
    await openEditor(tester);
    await tester.enterText(find.byKey(const Key('rule-name')), '阅读提醒');
    await chooseApp(tester);
    await tester.tap(find.byKey(const Key('save-rule')));
    await tester.pumpAndSettle();
    expect(find.text('阅读提醒'), findsOneWidget);
    expect(bridge.rules.single.enabled, false);
    expect(bridge.rules.single.targets.single.id, 'com.example.app');
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('periodic refresh and save failure preserve the editor input', (
    tester,
  ) async {
    final bridge = FakeBridge()..failSave = true;
    await tester.pumpWidget(BehaviorRulesApp(bridge: bridge));
    await tester.pumpAndSettle();
    await openEditor(tester);
    await tester.enterText(find.byKey(const Key('rule-name')), '正在输入的规则');
    await chooseApp(tester);
    await tester.pump(const Duration(seconds: 4));
    expect(find.text('正在输入的规则'), findsOneWidget);
    await tester.tap(find.byKey(const Key('save-rule')));
    await tester.pumpAndSettle();
    expect(find.text('保存失败，请重试'), findsWidgets);
    expect(find.text('正在输入的规则'), findsOneWidget);
    expect(bridge.rules, isEmpty);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets(
    'permission settings open only after an explicit purpose confirmation',
    (tester) async {
      final bridge = FakeBridge();
      await tester.pumpWidget(BehaviorRulesApp(bridge: bridge));
      await tester.pumpAndSettle();
      await tester.tap(find.text('运行与备份'));
      await tester.pumpAndSettle();
      expect(bridge.settingsOpened, 0);
      await tester.tap(find.byKey(const Key('authorize')));
      await tester.pumpAndSettle();
      expect(bridge.settingsOpened, 0);
      await tester.tap(find.text('了解并前往设置'));
      await tester.pumpAndSettle();
      expect(bridge.settingsOpened, 1);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
  testWidgets('import requires preview confirmation and refuses another platform', (
    tester,
  ) async {
    final bridge = FakeBridge()..importText = configText([fixtureRule()]);
    await tester.pumpWidget(BehaviorRulesApp(bridge: bridge));
    await tester.pumpAndSettle();
    await tester.tap(find.text('运行与备份'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.byKey(const Key('import-config')),
      350,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('import-config')));
    // The pending import indicator animates until the user confirms or cancels.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('导入预览'), findsOneWidget);
    expect(bridge.imports, 0);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(bridge.rules, isEmpty);
    bridge.importText = configText([], platform: 'ios');
    await tester.tap(find.byKey(const Key('import-config')));
    // The pending import indicator animates until the user confirms or cancels.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.textContaining('配置平台不一致'), findsWidgets);
    expect(bridge.imports, 0);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('confirmed import replaces rules and reports the imported result', (
    tester,
  ) async {
    final bridge = FakeBridge()..importText = configText([fixtureRule()]);
    await tester.pumpWidget(BehaviorRulesApp(bridge: bridge));
    await tester.pumpAndSettle();
    await tester.tap(find.text('运行与备份'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.byKey(const Key('import-config')),
      350,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('import-config')));
    // The pending import indicator animates until the user confirms or cancels.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.text('确认替换'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('我的规则'));
    await tester.pumpAndSettle();
    expect(find.text('专注'), findsOneWidget);
    expect(bridge.imports, 1);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets(
    'iOS editor uses opaque system selection and omits unsupported conditions',
    (tester) async {
      final bridge = FakeBridge()
        ..platform = 'ios'
        ..capabilities = {'appSelection': true, 'block': true};
      await tester.pumpWidget(BehaviorRulesApp(bridge: bridge));
      await tester.pumpAndSettle();
      await openEditor(tester);
      await tester.enterText(find.byKey(const Key('rule-name')), '全天专注');
      await tester.tap(find.byKey(const Key('choose-targets')));
      await tester.pumpAndSettle();
      expect(find.text('已选应用集合'), findsOneWidget);
      expect(find.byKey(const Key('quota-minutes')), findsNothing);
      await tester.tap(find.byKey(const Key('save-rule')));
      await tester.pumpAndSettle();
      expect(bridge.rules.single.targets.single.id, 'opaque_system_selection');
      expect(bridge.rules.single.action, RuleAction.block);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
  testWidgets(
    'delay preview keeps the custom action disabled until its countdown ends',
    (tester) async {
      final bridge = FakeBridge()
        ..rules = [
          BehaviorRule.fromJson(
            fixtureRule()..['delaySeconds'] = 3,
            platform: 'android',
          ),
        ];
      await tester.pumpWidget(BehaviorRulesApp(bridge: bridge));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('规则操作'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('效果预览'));
      await tester.pumpAndSettle();
      final button = find.widgetWithText(FilledButton, '继续');
      expect(tester.widget<FilledButton>(button).onPressed, isNull);
      await tester.pump(const Duration(seconds: 3));
      await tester.pump();
      expect(tester.widget<FilledButton>(button).onPressed, isNotNull);
      await tester.tap(find.text('关闭预览'));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
  testWidgets(
    'small screen with large text allows scrolling the editor without overflow',
    (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        BehaviorRulesApp(
          bridge: FakeBridge(),
          textScaler: const TextScaler.linear(1.8),
        ),
      );
      await tester.pumpAndSettle();
      await openEditor(tester);
      await tester.drag(find.byType(ListView).last, const Offset(0, -1500));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
