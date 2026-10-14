import 'dart:async';
import 'package:flutter/material.dart';
import '../models.dart';
import '../platform_bridge.dart';

class TargetPicker extends StatefulWidget {
  const TargetPicker({
    super.key,
    required this.apps,
    required this.selected,
    required this.title,
  });
  final List<AppTarget> apps, selected;
  final String title;
  @override
  State<TargetPicker> createState() => _TargetPickerState();
}

class _TargetPickerState extends State<TargetPicker> {
  late final Map<String, AppTarget> _selected = {
    for (final target in widget.selected) target.id: target,
  };
  String _query = '';
  @override
  Widget build(BuildContext context) {
    final all = <String, AppTarget>{
      for (final target in widget.selected) target.id: target,
      for (final target in widget.apps) target.id: target,
    };
    final filtered = all.values
        .where(
          (app) => '${app.label} ${app.id}'.toLowerCase().contains(
            _query.toLowerCase(),
          ),
        )
        .toList();
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
            child: TextField(
              decoration: const InputDecoration(
                hintText: '搜索应用名称或包名',
                prefixIcon: Icon(Icons.search),
              ),
              onChanged: (text) => setState(() => _query = text),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '已选 ${_selected.length}/100 个应用',
                style: Theme.of(context).textTheme.labelLarge,
              ),
            ),
          ),
          Expanded(
            child: filtered.isEmpty
                ? const Center(child: Text('没有找到可选择的应用'))
                : ListView.separated(
                    itemCount: filtered.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final app = filtered[index];
                      final installed = widget.apps.any(
                        (item) => item.id == app.id,
                      );
                      return CheckboxListTile(
                        value: _selected.containsKey(app.id),
                        title: Text(app.label),
                        subtitle: Text(
                          '${app.id}${installed ? '' : '\n当前未安装，可取消选择'}',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        controlAffinity: ListTileControlAffinity.leading,
                        onChanged: (checked) => setState(() {
                          if (checked == true) {
                            if (_selected.length >= 100) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text('每组最多选择 100 个应用')),
                              );
                              return;
                            }
                            _selected[app.id] = app;
                          } else {
                            _selected.remove(app.id);
                          }
                        }),
                      );
                    },
                  ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  key: const Key('confirm-targets'),
                  onPressed: () =>
                      Navigator.pop(context, _selected.values.toList()),
                  child: Text('确认选择（${_selected.length}）'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class RuleDraft {
  const RuleDraft({
    required this.name,
    required this.action,
    required this.message,
    this.quotaMinutes = 0,
    this.delaySeconds = 10,
    this.schedule = const RuleSchedule.always(),
  });
  final String name, message;
  final RuleAction action;
  final int quotaMinutes, delaySeconds;
  final RuleSchedule schedule;
}

class RuleEditor extends StatefulWidget {
  const RuleEditor({
    super.key,
    required this.bridge,
    required this.status,
    required this.onSaved,
    this.rule,
    this.draft,
  });
  final PlatformBridge bridge;
  final PlatformStatus status;
  final ValueChanged<AppState> onSaved;
  final BehaviorRule? rule;
  final RuleDraft? draft;
  @override
  State<RuleEditor> createState() => _RuleEditorState();
}

class _RuleEditorState extends State<RuleEditor> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _name,
      _message,
      _button,
      _quota,
      _delay,
      _priority;
  late List<AppTarget> _targets, _exceptions;
  late Set<int> _days;
  late RuleAction _action;
  late bool _enabled, _scheduleEnabled;
  late String _start, _end;
  bool _saving = false,
      _picking = false,
      _dirty = false,
      _allowPop = false,
      _closing = false;
  String? _error;
  Capabilities get _caps => widget.status.capabilities;
  @override
  void initState() {
    super.initState();
    final rule = widget.rule, draft = widget.draft;
    _action =
        rule?.action ??
        draft?.action ??
        RuleAction.values.firstWhere(
          _caps.supports,
          orElse: () => RuleAction.block,
        );
    _name = TextEditingController(text: rule?.name ?? draft?.name ?? '');
    _message = TextEditingController(
      text: rule?.message ?? draft?.message ?? '先停一下，想想现在最想做的事。',
    );
    _button = TextEditingController(
      text: rule?.buttonText ?? (_action == RuleAction.block ? '返回桌面' : '继续使用'),
    );
    _quota = TextEditingController(
      text: '${rule?.quotaMinutes ?? draft?.quotaMinutes ?? 0}',
    );
    _delay = TextEditingController(
      text: '${rule?.delaySeconds ?? draft?.delaySeconds ?? 10}',
    );
    _priority = TextEditingController(text: '${rule?.priority ?? 0}');
    _targets = List.of(rule?.targets ?? []);
    _exceptions = List.of(rule?.exceptions ?? []);
    final schedule =
        rule?.schedule ?? draft?.schedule ?? const RuleSchedule.always();
    _days = schedule.days.toSet();
    _scheduleEnabled = schedule.enabled;
    _start = schedule.start;
    _end = schedule.end;
    _enabled = rule?.enabled ?? false;
    for (final controller in [
      _name,
      _message,
      _button,
      _quota,
      _delay,
      _priority,
    ]) {
      controller.addListener(_changed);
    }
  }

  void _changed() {
    _dirty = true;
  }

  void _change(VoidCallback callback) {
    setState(() {
      callback();
      _dirty = true;
    });
  }

  @override
  void dispose() {
    for (final controller in [
      _name,
      _message,
      _button,
      _quota,
      _delay,
      _priority,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _close() async {
    if (_saving || _picking || _closing) return;
    _closing = true;
    final leave =
        !_dirty ||
        await showDialog<bool>(
              context: context,
              builder: (context) => AlertDialog(
                title: const Text('放弃未保存的修改？'),
                content: const Text('返回后，这次输入不会保存。'),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: const Text('继续编辑'),
                  ),
                  TextButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: const Text('放弃修改'),
                  ),
                ],
              ),
            ) ==
            true;
    _closing = false;
    if (leave && mounted) {
      setState(() => _allowPop = true);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.pop(context);
      });
    }
  }

  Future<void> _chooseTargets({bool exceptions = false}) async {
    setState(() {
      _picking = true;
      _error = null;
    });
    try {
      List<AppTarget>? selected;
      if (widget.status.platform == 'ios') {
        selected = await widget.bridge.pickTargets(
          selectionId: _targets.isEmpty ? null : _targets.first.id,
        );
      } else {
        final apps = exceptions ? _targets : await widget.bridge.listApps();
        if (!mounted) return;
        selected = await Navigator.push<List<AppTarget>>(
          context,
          MaterialPageRoute(
            builder: (_) => TargetPicker(
              apps: apps,
              selected: exceptions ? _exceptions : _targets,
              title: exceptions ? '选择例外应用' : '选择应用组',
            ),
          ),
        );
      }
      if (!mounted || selected == null) return;
      _change(() {
        if (exceptions) {
          _exceptions = selected!;
        } else {
          _targets = selected!;
          _exceptions.removeWhere(
            (item) => !_targets.any((target) => target.id == item.id),
          );
        }
      });
    } catch (error) {
      if (mounted) setState(() => _error = readableError(error));
    } finally {
      if (mounted) setState(() => _picking = false);
    }
  }

  Future<void> _pickTime(bool start) async {
    final text = start ? _start : _end;
    final parts = text.split(':');
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(
        hour: int.parse(parts[0]),
        minute: int.parse(parts[1]),
      ),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );
    if (time != null && mounted)
      _change(() {
        final formatted =
            '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';
        if (start) {
          _start = formatted;
        } else {
          _end = formatted;
        }
      });
  }

  BehaviorRule _value() => BehaviorRule.fromJson({
    'id': widget.rule?.id ?? 'rule_${DateTime.now().microsecondsSinceEpoch}',
    'name': _name.text.trim(),
    'enabled': _enabled,
    'targets': _targets.map((t) => t.toJson()).toList(),
    'exceptions': _exceptions.map((t) => t.toJson()).toList(),
    'schedule': {
      'enabled': _scheduleEnabled,
      'days': _days.toList()..sort(),
      'start': _start,
      'end': _end,
    },
    'quotaMinutes': int.tryParse(_quota.text),
    'action': _action.value,
    'delaySeconds': int.tryParse(_delay.text),
    'message': _message.text.trim(),
    'buttonText': _button.text.trim(),
    'priority': int.tryParse(_priority.text),
    'createdAt':
        widget.rule?.createdAt ?? DateTime.now().millisecondsSinceEpoch,
  }, platform: widget.status.platform);
  Future<void> _save() async {
    if (_saving || _picking) return;
    if (!_form.currentState!.validate()) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final rule = _value();
      _caps.validate(rule);
      final state = await widget.bridge.saveRule(rule);
      if (!mounted) return;
      widget.onSaved(state);
      setState(() {
        _allowPop = true;
        _dirty = false;
      });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.pop(context);
      });
    } catch (error) {
      if (mounted) {
        setState(() => _error = readableError(error));
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(readableError(error))));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String? _required(String? value) =>
      value == null || value.trim().isEmpty ? '请填写此项' : null;
  String? _integer(String? value, int min, int max) {
    final number = int.tryParse(value ?? '');
    return number == null || number < min || number > max
        ? '请输入 $min–$max 的整数'
        : null;
  }

  Widget _heading(String title, [String? subtitle]) => Padding(
    padding: const EdgeInsets.only(top: 28, bottom: 12),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: Theme.of(
            context,
          ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
        ),
        if (subtitle != null)
          Padding(
            padding: const EdgeInsets.only(top: 5),
            child: Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
          ),
      ],
    ),
  );
  @override
  Widget build(BuildContext context) => PopScope(
    canPop: _allowPop || (!_dirty && !_saving && !_picking),
    onPopInvokedWithResult: (didPop, _) {
      if (!didPop) _close();
    },
    child: Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          tooltip: '返回',
          onPressed: _close,
        ),
        title: Text(widget.rule == null ? '新建规则' : '编辑规则'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: TextButton(
              key: const Key('save-rule'),
              onPressed: _saving || _picking ? null : _save,
              child: Text(_saving ? '保存中' : '保存'),
            ),
          ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: AbsorbPointer(
          absorbing: _saving || _picking,
          child: Form(
            key: _form,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 40),
              children: [
                if (_saving || _picking) const LinearProgressIndicator(),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                TextFormField(
                  key: const Key('rule-name'),
                  controller: _name,
                  maxLength: 80,
                  validator: _required,
                  decoration: const InputDecoration(
                    labelText: '给这条规则起个名字',
                    hintText: '例如：少刷一会儿',
                  ),
                ),
                SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('启用这条规则'),
                  subtitle: const Text('新规则默认关闭，保存后可随时开启'),
                  value: _enabled,
                  onChanged: (value) => _change(() => _enabled = value),
                ),
                _heading(
                  '当我打开这些应用',
                  widget.status.platform == 'ios'
                      ? '使用 Apple 系统选择器，应用标识只保存在本机。'
                      : '同一组内的应用共享这条规则的每日额度。',
                ),
                OutlinedButton.icon(
                  key: const Key('choose-targets'),
                  onPressed: _caps.appSelection ? _chooseTargets : null,
                  icon: const Icon(Icons.apps_outlined),
                  label: Text(
                    _picking
                        ? '正在读取…'
                        : widget.status.platform == 'ios'
                        ? '打开系统应用选择器'
                        : '选择应用组',
                  ),
                ),
                if (!_caps.appSelection)
                  Text(
                    widget.status.message,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                if (_targets.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Text('还未选择应用'),
                  ),
                if (_targets.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      children: _targets
                          .map(
                            (target) => InputChip(
                              label: Text(target.label),
                              onDeleted: () => _change(() {
                                _targets.removeWhere(
                                  (item) => item.id == target.id,
                                );
                                _exceptions.removeWhere(
                                  (item) => item.id == target.id,
                                );
                              }),
                            ),
                          )
                          .toList(),
                    ),
                  ),
                if (_caps.schedules) ...[
                  _heading('在这些时候', '按手机本地时间执行；开始包含，结束不包含。'),
                  SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('限定生效时段'),
                    subtitle: Text(_scheduleEnabled ? '按下方时间执行' : '每天全天生效'),
                    value: _scheduleEnabled,
                    onChanged: (value) =>
                        _change(() => _scheduleEnabled = value),
                  ),
                  if (_scheduleEnabled) ...[
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        for (final day in [1, 2, 3, 4, 5, 6, 0])
                          FilterChip(
                            label: Text(
                              ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][day],
                            ),
                            selected: _days.contains(day),
                            onSelected: (value) => _change(() {
                              if (value) {
                                _days.add(day);
                              } else {
                                _days.remove(day);
                              }
                            }),
                          ),
                      ],
                    ),
                    Wrap(
                      spacing: 12,
                      children: [
                        TextButton.icon(
                          onPressed: () => _pickTime(true),
                          icon: const Icon(Icons.schedule),
                          label: Text('开始 $_start'),
                        ),
                        TextButton.icon(
                          onPressed: () => _pickTime(false),
                          icon: const Icon(Icons.schedule),
                          label: Text('结束 $_end'),
                        ),
                      ],
                    ),
                    Text(
                      _start == _end
                          ? '开始与结束相同，代表所选日期全天。'
                          : _start.compareTo(_end) > 0
                          ? '跨午夜时段归属于开始的那一天。'
                          : '只在所选时段内触发。',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ] else
                  _heading('每天 · 全天', '当前平台只支持全天规则与手动开关。'),
                if (_caps.quotas) ...[
                  _heading('每天可以用多久', '0 分钟表示打开即处理；应用组累计达到额度后触发，零点清零。'),
                  TextFormField(
                    key: const Key('quota-minutes'),
                    controller: _quota,
                    keyboardType: TextInputType.number,
                    validator: (value) => _integer(value, 0, 1440),
                    decoration: const InputDecoration(
                      labelText: '每日共享额度',
                      suffixText: '分钟',
                    ),
                  ),
                ],
                _heading('帮我……'),
                RadioGroup<RuleAction>(
                  groupValue: _action,
                  onChanged: (value) => _change(() {
                    _action = value!;
                    if (_button.text == '继续使用' || _button.text == '返回桌面')
                      _button.text = value == RuleAction.block
                          ? '返回桌面'
                          : '继续使用';
                  }),
                  child: Column(
                    children: RuleAction.values
                        .where(_caps.supports)
                        .map(
                          (action) => RadioListTile<RuleAction>(
                            contentPadding: EdgeInsets.zero,
                            value: action,
                            title: Text(action.label),
                            subtitle: Text(action.description),
                          ),
                        )
                        .toList(),
                  ),
                ),
                if (_action == RuleAction.delay && _caps.delay)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: TextFormField(
                      controller: _delay,
                      keyboardType: TextInputType.number,
                      validator: (value) => _integer(value, 1, 3600),
                      decoration: const InputDecoration(
                        labelText: '等待时间',
                        suffixText: '秒',
                      ),
                    ),
                  ),
                _heading('用自己的话提醒自己'),
                TextFormField(
                  controller: _message,
                  maxLines: 3,
                  maxLength: 1000,
                  validator: _required,
                  decoration: const InputDecoration(labelText: '提示内容'),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _button,
                  maxLength: 40,
                  validator: _required,
                  decoration: const InputDecoration(labelText: '按钮文字'),
                ),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: () => showRulePreview(
                      context,
                      action: _action,
                      message: _message.text,
                      button: _button.text,
                      delay: int.tryParse(_delay.text) ?? 10,
                      ios: widget.status.platform == 'ios',
                    ),
                    icon: const Icon(Icons.visibility_outlined),
                    label: const Text('效果预览'),
                  ),
                ),
                _heading('高级设置'),
                if (_caps.exceptions) ...[
                  OutlinedButton.icon(
                    onPressed: _targets.isEmpty
                        ? null
                        : () => _chooseTargets(exceptions: true),
                    icon: const Icon(Icons.remove_circle_outline),
                    label: Text('例外应用（${_exceptions.length}）'),
                  ),
                  if (_exceptions.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 8, bottom: 12),
                      child: Text(
                        _exceptions.map((item) => item.label).join('、'),
                      ),
                    ),
                  const Text('例外应用从这条规则的目标组中排除。'),
                  const SizedBox(height: 16),
                ],
                TextFormField(
                  controller: _priority,
                  keyboardType: const TextInputType.numberWithOptions(
                    signed: true,
                  ),
                  validator: (value) => _integer(value, -1000, 1000),
                  decoration: const InputDecoration(
                    labelText: '优先级',
                    helperText: '同一种动作中，数值越大越先执行',
                    helperMaxLines: 3,
                  ),
                ),
                const SizedBox(height: 16),
                const Text(
                  '多条规则同时满足时：直接拦截 ＞ 等待 ＞ 仅提醒；再按优先级、创建时间与标识排序。临时放行一条规则不会跳过其他规则。',
                  style: TextStyle(fontSize: 12, height: 1.6),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

Future<void> showRulePreview(
  BuildContext context, {
  required RuleAction action,
  required String message,
  required String button,
  required int delay,
  bool ios = false,
}) => showDialog<void>(
  context: context,
  builder: (_) => _RulePreview(
    action: action,
    message: message,
    button: button,
    delay: delay,
    ios: ios,
  ),
);

class _RulePreview extends StatefulWidget {
  const _RulePreview({
    required this.action,
    required this.message,
    required this.button,
    required this.delay,
    required this.ios,
  });
  final RuleAction action;
  final String message, button;
  final int delay;
  final bool ios;
  @override
  State<_RulePreview> createState() => _RulePreviewState();
}

class _RulePreviewState extends State<_RulePreview> {
  late int _remaining;
  Timer? _timer;
  @override
  void initState() {
    super.initState();
    _remaining = widget.action == RuleAction.delay
        ? widget.delay.clamp(1, 3600)
        : 0;
    if (_remaining > 0)
      _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (!mounted) {
          timer.cancel();
          return;
        }
        setState(() => _remaining--);
        if (_remaining <= 0) timer.cancel();
      });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    icon: Icon(switch (widget.action) {
      RuleAction.remind => Icons.notifications_none,
      RuleAction.delay => Icons.hourglass_empty,
      RuleAction.block => Icons.shield_outlined,
    }),
    title: Text('${widget.action.label} · 效果预览'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.message.isEmpty ? '你的提示内容会出现在这里' : widget.message),
          const SizedBox(height: 20),
          if (widget.action == RuleAction.delay)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                _remaining > 0 ? '还需等待 $_remaining 秒' : '等待结束，现在可以继续。',
              ),
            ),
          Text(
            widget.ios
                ? 'iOS 实际屏蔽界面由系统呈现；此处仅为文案参考。'
                : widget.action == RuleAction.remind
                ? '实际运行时显示非全屏提示，可以继续使用。'
                : '实际运行时覆盖目标应用；返回桌面不会结束其进程。',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('关闭预览'),
      ),
      FilledButton(
        onPressed: _remaining > 0 ? null : () => Navigator.pop(context),
        child: Text(widget.button.isEmpty ? '继续' : widget.button),
      ),
    ],
  );
}
