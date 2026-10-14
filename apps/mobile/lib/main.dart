import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'models.dart';
import 'platform_bridge.dart';
import 'screens/rule_editor.dart';

void main() => runApp(const BehaviorRulesApp());

class BehaviorRulesApp extends StatelessWidget {
  const BehaviorRulesApp({super.key, this.bridge, this.textScaler});
  final PlatformBridge? bridge;
  final TextScaler? textScaler;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: '行为规则',
    debugShowCheckedModeBanner: false,
    locale: const Locale('zh', 'CN'),
    supportedLocales: const [Locale('zh', 'CN'), Locale('en')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    theme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xFF147D76),
        brightness: Brightness.light,
      ),
      scaffoldBackgroundColor: const Color(0xFFF7F9F8),
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFFF7F9F8),
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 16,
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: Color(0xFFE2E9E6),
        thickness: 1,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(minimumSize: const Size(48, 48)),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: const Size(48, 48)),
      ),
      textTheme: const TextTheme(
        bodyMedium: TextStyle(height: 1.45),
        bodySmall: TextStyle(height: 1.45),
      ),
    ),
    builder: (context, child) => textScaler == null
        ? child!
        : MediaQuery(
            data: MediaQuery.of(context).copyWith(textScaler: textScaler),
            child: child!,
          ),
    home: RuleHome(bridge: bridge ?? const MethodChannelPlatformBridge()),
  );
}

class RuleHome extends StatefulWidget {
  const RuleHome({super.key, required this.bridge});
  final PlatformBridge bridge;
  @override
  State<RuleHome> createState() => _RuleHomeState();
}

class _RuleHomeState extends State<RuleHome> with WidgetsBindingObserver {
  AppState? _state;
  String? _loadError;
  Timer? _timer;
  bool _busy = false, _refreshing = false, _foreground = true;
  int _page = 0, _generation = 0;
  static const _titles = ['我的规则', '规则模板', '触发记录', '运行与备份'];
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (_foreground) _refresh();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_foreground) _refresh();
  }

  Future<void> _refresh() async {
    if (_busy || _refreshing) return;
    _refreshing = true;
    final generation = _generation;
    try {
      final state = await widget.bridge.getState();
      if (mounted && generation == _generation)
        setState(() {
          _state = state;
          _loadError = null;
        });
    } catch (error) {
      if (mounted && generation == _generation)
        setState(() => _loadError = readableError(error));
    } finally {
      _refreshing = false;
    }
  }

  void _adopt(AppState state) {
    _generation++;
    if (mounted)
      setState(() {
        _state = state;
        _loadError = null;
      });
  }

  void _notice(String message) {
    if (mounted)
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _perform(
    Future<AppState> Function() operation, {
    String? success,
  }) async {
    if (_busy) return;
    setState(() => _busy = true);
    _generation++;
    try {
      final state = await operation();
      if (mounted) {
        _adopt(state);
        if (success != null) _notice(success);
      }
    } catch (error) {
      _notice(readableError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _edit({BehaviorRule? rule, RuleDraft? draft}) async {
    final state = _state;
    if (state == null || _busy) return;
    if (rule == null && state.config.rules.length >= 200) {
      _notice('最多保存 200 条规则，请先删除不用的规则。');
      return;
    }
    await Navigator.push<void>(
      context,
      MaterialPageRoute(
        builder: (_) => RuleEditor(
          bridge: widget.bridge,
          status: state.status,
          rule: rule,
          draft: draft,
          onSaved: _adopt,
        ),
      ),
    );
    _refresh();
  }

  Future<bool> _confirm(
    String title,
    String content, {
    String confirm = '确认',
  }) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: SingleChildScrollView(child: Text(content)),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(confirm),
            ),
          ],
        ),
      ) ==
      true;
  Future<void> _delete(BehaviorRule rule) async {
    if (await _confirm(
          '删除「${rule.name}」？',
          '将移除这条规则及它的使用统计、等待状态和临时放行。',
          confirm: '删除规则',
        ) &&
        mounted) {
      await _perform(() => widget.bridge.deleteRule(rule.id), success: '规则已删除');
    }
  }

  Future<void> _authorize() async {
    final ios = _state?.status.platform == 'ios';
    final confirmed = await _confirm(
      ios ? '允许管理所选应用' : '为什么需要无障碍权限',
      ios
          ? '使用 Apple「屏幕使用时间」授权，选择需要管理的应用，并通过系统屏蔽。授权由你在系统对话框中决定，随时可以撤销。'
          : '行为规则需要无障碍服务来识别当前前台应用，并显示提醒、等待或拦截遮罩。\n\n只监听前台窗口所属的应用包名，不读取界面文字，不采集输入内容，不上传数据。\n\n接下来打开系统设置，请自行选择「行为规则」并开启服务。你可以随时在设置中关闭它。',
      confirm: ios ? '继续系统授权' : '了解并前往设置',
    );
    if (!confirmed || !mounted) return;
    setState(() => _busy = true);
    _generation++;
    try {
      if (ios) {
        await widget.bridge.requestAuthorization();
      } else {
        await widget.bridge.openAccessibilitySettings();
      }
    } catch (error) {
      _notice(readableError(error));
    } finally {
      if (mounted) {
        setState(() => _busy = false);
        _refresh();
      }
    }
  }

  Future<void> _openSettings(Future<void> Function() action) async {
    try {
      await action();
    } catch (error) {
      _notice(readableError(error));
    }
  }

  Future<void> _export() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final message = await widget.bridge.exportConfig();
      if (message != null) _notice(message);
    } catch (error) {
      _notice(readableError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _import() async {
    if (_busy || _state == null) return;
    setState(() => _busy = true);
    _generation++;
    try {
      final text = await widget.bridge.readImportFile();
      if (!mounted || text == null) return;
      final config = RuleConfig.parse(
        text,
        expectedPlatform: _state!.config.platform,
        capabilities: _state!.status.capabilities,
      );
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('导入预览'),
          content: SizedBox(
            width: double.maxFinite,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${config.platform == 'android' ? 'Android' : 'iOS'} · ${config.rules.length} 条规则 · ${config.rules.where((r) => r.enabled).length} 条已启用',
                  ),
                  const SizedBox(height: 12),
                  const Text('确认后替换现有全部规则，并清空使用统计、等待状态和临时放行。触发记录保留。'),
                  const SizedBox(height: 16),
                  ...config.rules.map(
                    (rule) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Text(
                        '${rule.enabled ? '开启' : '关闭'} · ${rule.name}\n${rule.action.label} · ${rule.targets.length} 个应用目标',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                  ),
                  if (config.rules.isEmpty) const Text('此备份没有规则，导入后会清空现有规则。'),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('确认替换'),
            ),
          ],
        ),
      );
      if (confirmed == true && mounted) {
        _adopt(await widget.bridge.importConfig(text));
        _notice('规则已导入');
      }
    } catch (error) {
      _notice(readableError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  bool get _canEdit =>
      _state != null &&
      RuleAction.values.any(_state!.status.capabilities.supports);
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(
        _titles[_page],
        style: const TextStyle(fontWeight: FontWeight.w700),
      ),
      actions: [
        if (_page == 0)
          IconButton(
            key: const Key('add-rule'),
            tooltip: '新建规则',
            onPressed: _canEdit && !_busy ? () => _edit() : null,
            icon: const Icon(Icons.add),
          ),
        if (_page == 2 && (_state?.logs.isNotEmpty ?? false))
          IconButton(
            tooltip: '清空记录',
            onPressed: _busy
                ? null
                : () async {
                    if (await _confirm(
                          '清空触发记录？',
                          '清空后无法恢复，规则与使用统计不会改变。',
                          confirm: '清空记录',
                        ) &&
                        mounted)
                      _perform(widget.bridge.clearLogs);
                  },
            icon: const Icon(Icons.delete_outline),
          ),
      ],
    ),
    body: Column(
      children: [
        if (_busy) const LinearProgressIndicator(minHeight: 2),
        if (_loadError != null && _state != null)
          Material(
            color: Theme.of(context).colorScheme.errorContainer,
            child: ListTile(
              leading: const Icon(Icons.cloud_off_outlined),
              title: Text(
                '状态更新失败：$_loadError',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              trailing: IconButton(
                onPressed: _refresh,
                tooltip: '重试',
                icon: const Icon(Icons.refresh),
              ),
            ),
          ),
        Expanded(
          child: _state == null
              ? _initialState()
              : switch (_page) {
                  0 => _rules(),
                  1 => _templates(),
                  2 => _logs(),
                  _ => _settings(),
                },
        ),
      ],
    ),
    bottomNavigationBar: _navigation(),
  );
  Widget _navigation() => Material(
    color: Colors.white,
    child: SafeArea(
      top: false,
      child: Container(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: Color(0xFFE2E9E6))),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var index = 0; index < 4; index++)
              Expanded(
                child: Semantics(
                  selected: _page == index,
                  button: true,
                  child: InkWell(
                    onTap: () => setState(() => _page = index),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        vertical: 12,
                        horizontal: 3,
                      ),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            [
                              Icons.tune,
                              Icons.grid_view_outlined,
                              Icons.history,
                              Icons.shield_outlined,
                            ][index],
                            color: _page == index
                                ? Theme.of(context).colorScheme.primary
                                : const Color(0xFF64746E),
                          ),
                          const SizedBox(height: 5),
                          Text(
                            ['我的规则', '模板', '触发记录', '运行与备份'][index],
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: _page == index
                                  ? FontWeight.w700
                                  : FontWeight.w400,
                              color: _page == index
                                  ? Theme.of(context).colorScheme.primary
                                  : const Color(0xFF64746E),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    ),
  );
  Widget _initialState() => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: _loadError == null
          ? const CircularProgressIndicator()
          : SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.phonelink_off, size: 36),
                  const SizedBox(height: 16),
                  Text(_loadError!, textAlign: TextAlign.center),
                  const SizedBox(height: 16),
                  OutlinedButton.icon(
                    onPressed: _refresh,
                    icon: const Icon(Icons.refresh),
                    label: const Text('重新连接'),
                  ),
                ],
              ),
            ),
    ),
  );
  Widget _statusStrip() {
    final status = _state!.status;
    return InkWell(
      onTap: () => setState(() => _page = 3),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: status.monitoring
              ? const Color(0xFFE9F4EF)
              : const Color(0xFFFFF4DF),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              status.monitoring
                  ? Icons.check_circle_outline
                  : Icons.info_outline,
              size: 20,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    status.headline,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  if (status.message.isNotEmpty)
                    Text(
                      status.message,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, size: 20),
          ],
        ),
      ),
    );
  }

  Widget _rules() {
    final rules = _state!.config.rules;
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          _statusStrip(),
          const SizedBox(height: 24),
          Text(
            '${rules.length} 条规则 · ${rules.where((r) => r.enabled).length} 条已开启',
            style: Theme.of(context).textTheme.labelLarge,
          ),
          const SizedBox(height: 8),
          const Text(
            '给每一次打开，留一点选择的空间。',
            style: TextStyle(color: Color(0xFF64746E)),
          ),
          const SizedBox(height: 20),
          if (rules.isEmpty)
            _empty(
              Icons.tune,
              '从一条小规则开始',
              '选择应用、设定时段，再决定如何提醒自己。新规则默认关闭。',
              button: OutlinedButton(
                onPressed: _canEdit ? () => _edit() : null,
                child: const Text('创建第一条规则'),
              ),
            ),
          ...rules.map(_ruleTile),
          if (rules.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                '同时满足多条规则时，先执行拦截，再执行等待和提醒。每条规则独立累计额度。',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
        ],
      ),
    );
  }

  Widget _ruleTile(BehaviorRule rule) {
    final state = _state!, remaining = _state!.bypassRemaining(rule.id);
    final used = (state.usedMilliseconds(rule.id) / 60000).floor();
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(14, 8, 8, 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE2E9E6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: InkWell(
                  onTap: () => _edit(rule: rule),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Text(
                      rule.name,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ),
              Switch.adaptive(
                value: rule.enabled,
                onChanged:
                    _busy || !state.status.capabilities.supports(rule.action)
                    ? null
                    : (value) => _perform(
                        () => widget.bridge.toggleRule(rule.id, value),
                      ),
              ),
              PopupMenuButton<String>(
                tooltip: '规则操作',
                enabled: !_busy,
                onSelected: (value) {
                  switch (value) {
                    case 'edit':
                      _edit(rule: rule);
                    case 'preview':
                      showRulePreview(
                        context,
                        action: rule.action,
                        message: rule.message,
                        button: rule.buttonText,
                        delay: rule.delaySeconds,
                        ios: state.status.platform == 'ios',
                      );
                    case 'bypass':
                      _perform(
                        () => widget.bridge.bypassRule(rule.id),
                        success: '这条规则已临时放行 15 分钟',
                      );
                    case 'revoke':
                      _perform(
                        () => widget.bridge.revokeBypass(rule.id),
                        success: '已结束临时放行',
                      );
                    case 'delete':
                      _delete(rule);
                  }
                },
                itemBuilder: (_) => [
                  const PopupMenuItem(value: 'edit', child: Text('编辑规则')),
                  const PopupMenuItem(value: 'preview', child: Text('效果预览')),
                  if (rule.enabled)
                    PopupMenuItem(
                      value: remaining > 0 ? 'revoke' : 'bypass',
                      child: Text(remaining > 0 ? '结束临时放行' : '临时放行 15 分钟'),
                    ),
                  const PopupMenuItem(value: 'delete', child: Text('删除规则')),
                ],
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Text(
              rule.targets.map((t) => t.label).join('、'),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              _tag(rule.action.label),
              _tag(rule.schedule.summary),
              if (rule.exceptions.isNotEmpty)
                _tag('${rule.exceptions.length} 个例外'),
            ],
          ),
          if (state.status.capabilities.quotas)
            Padding(
              padding: const EdgeInsets.only(top: 10, right: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    rule.quotaMinutes == 0
                        ? '今日累计 $used 分钟 · 打开即处理'
                        : '今日累计 $used / ${rule.quotaMinutes} 分钟',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  if (rule.quotaMinutes > 0)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: LinearProgressIndicator(
                        value:
                            (state.usedMilliseconds(rule.id) /
                                    (rule.quotaMinutes * 60000))
                                .clamp(0, 1),
                        minHeight: 3,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                ],
              ),
            ),
          if (remaining > 0)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Text(
                '临时放行中 · 约剩 ${(remaining / 60000).ceil()} 分钟',
                style: TextStyle(
                  color: Theme.of(context).colorScheme.primary,
                  fontSize: 12,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _tag(String text) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    decoration: BoxDecoration(
      color: const Color(0xFFF0F5F2),
      borderRadius: BorderRadius.circular(6),
    ),
    child: Text(
      text,
      style: const TextStyle(fontSize: 12, color: Color(0xFF3A6254)),
    ),
  );
  Widget _empty(
    IconData icon,
    String title,
    String description, {
    Widget? button,
  }) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 28),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 36, color: Theme.of(context).colorScheme.primary),
        const SizedBox(height: 16),
        Text(title, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        Text(description),
        if (button != null) ...[const SizedBox(height: 20), button],
      ],
    ),
  );
  Widget _templates() {
    final caps = _state!.status.capabilities;
    final templates = [
      if (caps.remind)
        const RuleDraft(
          name: '打开前，想一想',
          action: RuleAction.remind,
          message: '这次打开，是为了什么？想清楚再继续。',
        ),
      if (caps.delay)
        const RuleDraft(
          name: '先等 10 秒',
          action: RuleAction.delay,
          message: '给冲动一点时间，也许现在不需要打开。',
        ),
      if (caps.quotas && caps.block)
        const RuleDraft(
          name: '娱乐半小时',
          action: RuleAction.block,
          message: '今天的娱乐时间已用完，换件事做吧。',
          quotaMinutes: 30,
        ),
      if (caps.schedules && caps.block)
        const RuleDraft(
          name: '睡前少刷一会儿',
          action: RuleAction.block,
          message: '把时间还给睡眠，明天再见。',
          schedule: RuleSchedule(
            enabled: true,
            days: [0, 1, 2, 3, 4, 5, 6],
            start: '22:30',
            end: '07:00',
          ),
        ),
      if (caps.block)
        const RuleDraft(
          name: '留出专注空间',
          action: RuleAction.block,
          message: '此刻，把注意力放回你选择的事情上。',
        ),
    ];
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
      children: [
        Text(
          '从一个适合你的场景开始',
          style: Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        const Text('选择模板后再选应用。你可以改写所有文字，规则不会自动启用。'),
        const SizedBox(height: 24),
        if (templates.isEmpty)
          _empty(Icons.info_outline, '当前平台暂无可用模板', _state!.status.message),
        ...templates.map(
          (draft) => Column(
            children: [
              ListTile(
                contentPadding: const EdgeInsets.symmetric(vertical: 12),
                title: Text(
                  draft.name,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                subtitle: Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    '${draft.message}\n${draft.action.label} · ${draft.quotaMinutes == 0 ? draft.schedule.summary : '每天 ${draft.quotaMinutes} 分钟'}',
                  ),
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => _edit(draft: draft),
              ),
              const Divider(height: 1),
            ],
          ),
        ),
      ],
    );
  }

  Widget _logs() {
    final logs = _state!.logs;
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const Text('最近 300 条记录，仅保存在这台设备上。'),
          const SizedBox(height: 12),
          if (logs.isEmpty)
            _empty(Icons.history, '还没有触发记录', '规则实际触发或临时放行后，记录会出现在这里。'),
          ...logs.map(
            (log) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 16),
                Text(
                  '${_actionLabel(log.action)} · ${log.ruleName}',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 6),
                Text(log.targetLabel),
                if (log.reason.isNotEmpty)
                  Text(
                    log.reason,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                const SizedBox(height: 6),
                Text(
                  _formatTime(log.at),
                  style: Theme.of(context).textTheme.labelSmall,
                ),
                const SizedBox(height: 16),
                const Divider(height: 1),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _actionLabel(String action) => switch (action) {
    'remind' => '提醒',
    'delay' => '等待',
    'block' => '拦截',
    'bypass' => '放行',
    _ => action,
  };
  String _formatTime(int milliseconds) {
    if (milliseconds == 0) return '暂无';
    try {
      final date = DateTime.fromMillisecondsSinceEpoch(milliseconds).toLocal();
      String pad(int value) => value.toString().padLeft(2, '0');
      return '${date.year}-${pad(date.month)}-${pad(date.day)} ${pad(date.hour)}:${pad(date.minute)}:${pad(date.second)}';
    } catch (_) {
      return '时间超出显示范围';
    }
  }

  Widget _section(String title) => Padding(
    padding: const EdgeInsets.only(top: 26, bottom: 12),
    child: Text(
      title,
      style: Theme.of(
        context,
      ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
    ),
  );
  Widget _settingRow(
    String title,
    String value, {
    IconData? icon,
    VoidCallback? onTap,
  }) => ListTile(
    contentPadding: EdgeInsets.zero,
    title: Text(title),
    subtitle: Text(value),
    trailing: icon == null ? null : Icon(icon),
    onTap: onTap,
  );
  Widget _settings() {
    final state = _state!,
        status = _state!.status,
        caps = _state!.status.capabilities;
    final android = status.platform == 'android';
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 36),
      children: [
        _statusStrip(),
        _section('运行状态'),
        _settingRow(
          android ? '无障碍权限' : '屏幕使用时间权限',
          status.permissionGranted ? '已授权' : '未授权',
        ),
        _settingRow('规则服务', status.monitoring ? '已连接' : '未连接'),
        _settingRow('最近一次系统事件', _formatTime(status.lastEventAt)),
        FilledButton.icon(
          key: const Key('authorize'),
          onPressed: _busy ? null : _authorize,
          icon: const Icon(Icons.security),
          label: Text(android ? '查看用途并设置权限' : '查看用途并请求授权'),
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: _busy ? null : _refresh,
          child: const Text('刷新运行状态'),
        ),
        if (android) ...[
          _section('后台运行'),
          _settingRow(
            '系统电池优化',
            status.batteryOptimized ? '当前受到电池优化管理' : '当前不受标准电池优化管理',
            icon: Icons.open_in_new,
            onTap: () => _openSettings(widget.bridge.openBatterySettings),
          ),
          const Text('厂商省电策略可能中断服务。可在系统设置中检查电池与后台运行限制；本应用不会自动修改这些设置。'),
        ],
        _settingRow(
          '应用系统设置',
          '管理系统权限与应用信息',
          icon: Icons.open_in_new,
          onTap: () => _openSettings(widget.bridge.openAppSettings),
        ),
        _section('当前平台能力'),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            _capability('应用选择', caps.appSelection),
            _capability('提醒', caps.remind),
            _capability('等待', caps.delay),
            _capability('拦截', caps.block),
            _capability('时段', caps.schedules),
            _capability('额度', caps.quotas),
            _capability('例外', caps.exceptions),
          ],
        ),
        if (!android)
          const Padding(
            padding: EdgeInsets.only(top: 14),
            child: Text(
              'iOS 当前仅支持系统应用选择与全天屏蔽，使用手动开关管理。此工程尚未通过 Xcode 签名构建与 iPhone 真机验证；提醒、等待、时段、额度及例外未开放。',
            ),
          ),
        _section('规则备份'),
        Text(
          '当前 ${state.config.rules.length} 条规则。备份仅含规则，不含使用统计与触发记录。Android 与 iOS 配置不能互相导入。',
        ),
        const SizedBox(height: 14),
        OutlinedButton.icon(
          onPressed: _busy ? null : _export,
          icon: const Icon(Icons.file_upload_outlined),
          label: const Text('导出 JSON 文件'),
        ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          key: const Key('import-config'),
          onPressed: _busy ? null : _import,
          icon: const Icon(Icons.file_download_outlined),
          label: const Text('从 JSON 文件导入'),
        ),
        const SizedBox(height: 10),
        const Text(
          '最多 200 条规则、每组 100 个目标，文件不超过 2 MiB。导入前会显示预览，确认后替换规则并清空用时与放行。',
          style: TextStyle(fontSize: 12, height: 1.6),
        ),
        _section('数据与边界'),
        const Text(
          '无需账号，不上传数据。规则、用时与记录保存在本机。卸载会清除本机数据，请提前导出备份。\n\n本工具帮助你管理自己的习惯，可以随时停用或卸载。系统事件可能有延迟；分屏、画中画和厂商后台限制仍需在具体设备上验证。',
        ),
      ],
    );
  }

  Widget _capability(String name, bool supported) =>
      _tag('$name ${supported ? '可用' : '暂不支持'}');
}
