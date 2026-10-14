import 'dart:io';
import 'package:flutter/services.dart';
import 'models.dart';

abstract class PlatformBridge {
  Future<AppState> getState();
  Future<List<AppTarget>> listApps();
  Future<List<AppTarget>?> pickTargets({String? selectionId});
  Future<AppState> saveRule(BehaviorRule rule);
  Future<AppState> deleteRule(String id);
  Future<AppState> toggleRule(String id, bool enabled);
  Future<AppState> bypassRule(String id);
  Future<AppState> revokeBypass(String id);
  Future<AppState> clearLogs();
  Future<String> getConfigJson();
  Future<String?> exportConfig();
  Future<String?> readImportFile();
  Future<AppState> importConfig(String json);
  Future<void> openAccessibilitySettings();
  Future<void> openAppSettings();
  Future<void> openBatterySettings();
  Future<PlatformStatus> requestAuthorization();
}

class MethodChannelPlatformBridge implements PlatformBridge {
  const MethodChannelPlatformBridge();
  static const _channel = MethodChannel('behavior_rules/platform');
  Future<T?> _call<T>(String method, [Map<String, dynamic>? arguments]) async {
    if (!Platform.isAndroid && !Platform.isIOS) {
      throw PlatformException(
        code: 'unsupported_platform',
        message: '请在 Android 或 iOS 设备上运行。桌面与网页不提供应用监测。',
      );
    }
    return _channel.invokeMethod<T>(method, arguments);
  }

  Future<AppState> _state(
    String method, [
    Map<String, dynamic>? arguments,
  ]) async => AppState.fromJson(await _call<Object?>(method, arguments));
  @override
  Future<AppState> getState() => _state('getState');
  @override
  Future<List<AppTarget>> listApps() async {
    final result = await _call<List<dynamic>>('listApps');
    if (result == null) throw const FormatException('未能读取应用列表');
    return result
        .map((item) => AppTarget.fromJson(item, platform: 'android'))
        .toList();
  }

  @override
  Future<List<AppTarget>?> pickTargets({String? selectionId}) async {
    final result = await _call<List<dynamic>>('pickTargets', {
      if (selectionId != null) 'selectionId': selectionId,
    });
    return result
        ?.map((item) => AppTarget.fromJson(item, platform: 'ios'))
        .toList();
  }

  @override
  Future<AppState> saveRule(BehaviorRule rule) =>
      _state('saveRule', {'rule': rule.toJson()});
  @override
  Future<AppState> deleteRule(String id) => _state('deleteRule', {'id': id});
  @override
  Future<AppState> toggleRule(String id, bool enabled) =>
      _state('toggleRule', {'id': id, 'enabled': enabled});
  @override
  Future<AppState> bypassRule(String id) =>
      _state('bypassRule', {'id': id, 'minutes': 15});
  @override
  Future<AppState> revokeBypass(String id) =>
      _state('revokeBypass', {'id': id});
  @override
  Future<AppState> clearLogs() => _state('clearLogs');
  @override
  Future<String> getConfigJson() async =>
      await _call<String>('getConfigJson') ??
      (throw const FormatException('未能读取备份'));
  @override
  Future<String?> exportConfig() => _call<String>('exportConfig');
  @override
  Future<String?> readImportFile() => _call<String>('readImportFile');
  @override
  Future<AppState> importConfig(String json) =>
      _state('importConfig', {'json': json});
  @override
  Future<void> openAccessibilitySettings() async {
    await _call<Object?>('openAccessibilitySettings');
  }

  @override
  Future<void> openAppSettings() async {
    await _call<Object?>('openAppSettings');
  }

  @override
  Future<void> openBatterySettings() async {
    await _call<Object?>('openBatterySettings');
  }

  @override
  Future<PlatformStatus> requestAuthorization() async =>
      PlatformStatus.fromJson(await _call<Object?>('requestAuthorization'));
}

String readableError(Object error) {
  if (error is PlatformException)
    return error.message?.trim().isNotEmpty == true
        ? error.message!
        : '系统操作失败，请重试（${error.code}）';
  if (error is MissingPluginException) return '原生服务尚未连接。请在已安装此应用的手机上重试。';
  if (error is FormatException) return error.message;
  return '操作未完成，请重试。原有输入已保留。';
}
