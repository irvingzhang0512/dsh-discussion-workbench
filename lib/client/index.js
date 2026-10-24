import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { SETTINGS_NAMESPACE } from "../shared/settings.js";
import { hostWebSocketUrl } from "./host-websocket.js";
export const inject = ['slots'];
/** 卡片头部显示的版本号。 */
const PLUGIN_VERSION = typeof __DWB_VERSION__ === 'string' && __DWB_VERSION__ !== ''
    ? __DWB_VERSION__
    : '0.0.0-dev';
const targets = new Map();
export function apply(ctx) {
    window.__DSH_DISCUSSION_WORKBENCH__ = { getTarget: sessionId => targets.get(sessionId) ?? null, ownsDocumentBinding: true };
    injectStyle();
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsh-discussion-workbench', order: -20, label: () => '讨论工作台' }, props => _jsx(WorkbenchBar, { sessionId: props.sessionId })));
    // 设置卡是可选 UI：settingsScope 缺失时不注册，摘要栏与工作台其他功能照常（F010）。
    ctx.inject(['settingsScope'], sctx => {
        const settingsScope = sctx.settingsScope;
        if (settingsScope === undefined)
            return;
        const bound = settingsScope.bind({ namespace: SETTINGS_NAMESPACE });
        ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({ name: 'settings.plugin.item', key: SETTINGS_NAMESPACE, order: 100 }, () => _jsx(DockSettingsCard, { scope: bound })));
    });
    ctx.effect(() => () => {
        delete window.__DSH_DISCUSSION_WORKBENCH__;
        targets.clear();
    }, 'dsh-discussion-workbench: client');
}
function WorkbenchBar({ sessionId }) {
    const id = String(sessionId ?? '');
    const [state, setState] = useState(null);
    const [error, setError] = useState('');
    const [expanded, setExpanded] = useState(false);
    const [target, setTarget] = useState('');
    const [materialPath, setMaterialPath] = useState('');
    const [connected, setConnected] = useState(false);
    const [pending, setPending] = useState(null);
    const [notice, setNotice] = useState('');
    const targetDirtyRef = useRef(false);
    const pendingRef = useRef(null);
    const uncertainRef = useRef(false);
    const [pasteOpen, setPasteOpen] = useState(false);
    const [pasteLabel, setPasteLabel] = useState('粘贴材料');
    const [pasteContent, setPasteContent] = useState('');
    const [meetingFolder, setMeetingFolder] = useState('');
    const [docxPath, setDocxPath] = useState('');
    const [sourceQuery, setSourceQuery] = useState('');
    const [sourceText, setSourceText] = useState('');
    const [editorOpen, setEditorOpen] = useState(false);
    const [editTitle, setEditTitle] = useState('');
    const [editContent, setEditContent] = useState('');
    const socket = useMemo(() => ({ current: null }), [id]);
    useEffect(() => {
        if (id === '')
            return;
        setState(null);
        setConnected(false);
        setError('');
        setNotice('');
        setPending(null);
        pendingRef.current = null;
        uncertainRef.current = false;
        targetDirtyRef.current = false;
        let stopped = false;
        let retry;
        const connect = () => {
            let ws;
            try {
                ws = new WebSocket(hostWebSocketUrl('/discussion-workbench/ws', id));
            }
            catch {
                setError('宿主连接地址尚未就绪。');
                if (!stopped)
                    retry = window.setTimeout(connect, 1000);
                return;
            }
            socket.current = ws;
            ws.onopen = () => { setConnected(true); ws.send(JSON.stringify({ type: 'hello' })); };
            ws.onmessage = event => {
                if (stopped || socket.current !== ws)
                    return;
                try {
                    const message = JSON.parse(String(event.data));
                    if (message.type === 'state' && message.state !== undefined) {
                        const previous = targets.get(id);
                        targets.set(id, message.state.targetFile);
                        setState(message.state);
                        if (uncertainRef.current) {
                            uncertainRef.current = false;
                            pendingRef.current = null;
                            setPending(null);
                            setNotice('连接已恢复，请根据当前目标和材料状态核实上次操作结果。');
                        }
                        if (!targetDirtyRef.current)
                            setTarget(message.state.targetFile ?? '');
                        if (previous !== message.state.targetFile)
                            window.dispatchEvent(new Event('dsh-workbench:target'));
                    }
                    else if (message.type === 'operation-result') {
                        const result = message;
                        if (pendingRef.current?.id !== result.requestId)
                            return;
                        const completed = pendingRef.current;
                        pendingRef.current = null;
                        uncertainRef.current = false;
                        setPending(null);
                        if (result.ok) {
                            setNotice(result.message ?? '操作已完成。');
                            setError('');
                            targetDirtyRef.current = false;
                            if (completed?.clearMaterial)
                                setMaterialPath('');
                        }
                        else
                            setError(result.message ?? '工作台操作失败');
                    }
                    else if (message.type === 'error')
                        setError(message.message ?? '工作台操作失败');
                    else if (message.type === 'source-content') {
                        if (message.ok) {
                            setSourceText(`${message.label ?? '原文'}\n\n${message.content ?? ''}`);
                            setError('');
                        }
                        else
                            setError(message.message ?? '读取原文失败');
                    }
                }
                catch {
                    setError('工作台返回了无法解析的状态。');
                }
            };
            ws.onclose = () => {
                setConnected(false);
                setPending(value => {
                    if (value === null)
                        return null;
                    uncertainRef.current = true;
                    const uncertain = { ...value, label: `${value.label}（结果待核实）` };
                    pendingRef.current = uncertain;
                    return uncertain;
                });
                if (!stopped)
                    retry = window.setTimeout(connect, 1000);
            };
            ws.onerror = () => ws.close();
        };
        connect();
        return () => { stopped = true; if (retry !== undefined)
            clearTimeout(retry); socket.current?.close(); targets.delete(id); };
    }, [id, socket]);
    if (id === '')
        return null;
    // 宿主按配置与使用痕迹下发显示判定（F009）：未判定为显示时不渲染，也不占用输入区。
    if (state?.dock !== true)
        return null;
    const send = (message) => {
        if (socket.current?.readyState !== WebSocket.OPEN) {
            setError('工作台尚未连接。');
            return;
        }
        socket.current.send(JSON.stringify(message));
    };
    const submitContext = (message, label, clearMaterial = false) => {
        if (pending !== null)
            return;
        if (socket.current?.readyState !== WebSocket.OPEN) {
            setError('工作台尚未连接。');
            return;
        }
        const requestId = globalThis.crypto.randomUUID();
        const operation = { id: requestId, label, ...(clearMaterial ? { clearMaterial: true } : {}) };
        pendingRef.current = operation;
        setPending(operation);
        setNotice('');
        setError('');
        socket.current.send(JSON.stringify({ ...message, type: 'set-context', requestId }));
    };
    const sceneLabel = state?.scene === 'project' ? '项目更新' : '会议整理';
    const selected = state?.document?.selectedNodeTitle || '无';
    const targetName = shortName(state?.targetFile) || '未设置';
    const panelId = `dwb-panel-${id}`;
    const status = state?.task.phase === 'idle' ? '' : state?.task.label;
    return (_jsxs("div", { className: "dwb-shell", children: [_jsxs("button", { className: "dwb-summary", type: "button", onClick: () => setExpanded(value => !value), "aria-expanded": expanded, "aria-controls": expanded ? panelId : undefined, children: [_jsxs("span", { className: "dwb-scene", title: `场景：${sceneLabel} · ${connected ? '工作台已连接' : '工作台未连接'}`, children: [_jsx("span", { className: `dwb-dot ${connected ? 'is-online' : ''}`, "aria-hidden": "true" }), _jsx("span", { className: "dwb-scene-label", children: "\u573A\u666F" }), _jsx("span", { className: "dwb-scene-name", children: sceneLabel })] }), _jsxs("span", { className: "dwb-summary-details", children: [_jsxs("span", { className: "dwb-summary-item dwb-summary-materials", children: [_jsx("span", { className: "dwb-summary-label", children: "\u53C2\u8003\u6750\u6599" }), _jsx("span", { className: "dwb-count", children: state?.materials.length ?? 0 })] }), _jsxs("span", { className: "dwb-summary-item", title: state?.targetFile ?? '尚未设置整理目标', children: [_jsx("span", { className: "dwb-summary-label", children: "\u6574\u7406\u76EE\u6807" }), _jsx("span", { className: `dwb-summary-value ${state?.targetFile ? '' : 'is-empty'}`, children: targetName })] }), _jsxs("span", { className: "dwb-summary-item", title: state?.document?.selectedNodeTitle || '尚未选择节点', children: [_jsx("span", { className: "dwb-summary-label", children: "\u5F53\u524D\u8282\u70B9" }), _jsx("span", { className: `dwb-summary-value ${state?.document?.selectedNodeTitle ? '' : 'is-empty'}`, children: selected })] })] }), _jsxs("span", { className: "dwb-caret", children: [_jsx("span", { children: expanded ? '收起' : '展开' }), _jsx("svg", { className: "dwb-chevron", viewBox: "0 0 16 16", width: "14", height: "14", fill: "none", "aria-hidden": "true", focusable: "false", children: _jsx("path", { d: "m4 6 4 4 4-4", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }) })] })] }), status && _jsx("div", { className: `dwb-task is-${state?.task.phase}`, children: status }), error && _jsx("div", { className: "dwb-error", children: error }), pending && _jsx("div", { className: "dwb-task is-saving", children: pending.label }), notice && _jsx("div", { className: "dwb-notice", children: notice }), expanded && _jsxs("div", { className: "dwb-panel", id: panelId, children: [_jsxs("div", { className: "dwb-meeting", children: [_jsx("label", { children: "\u4F1A\u8BAE\u6587\u4EF6\u5939" }), _jsx("input", { value: meetingFolder, onChange: event => setMeetingFolder(event.target.value), placeholder: "\u5DE5\u4F5C\u533A\u5185\u7684\u4F1A\u8BAE\u6587\u4EF6\u5939" }), _jsx("button", { type: "button", disabled: !connected || pending !== null, onClick: () => submitMeeting(send, 'open-meeting', { folder: meetingFolder }, '正在打开会议…'), children: "\u6253\u5F00\u4F1A\u8BAE" }), state?.meeting && _jsxs(_Fragment, { children: [_jsx("button", { className: state.meeting.activeDocument === 'record' ? 'is-active' : '', type: "button", onClick: () => submitMeeting(send, 'select-record', {}, '正在切换会议记录…'), children: "\u4F1A\u8BAE\u8BB0\u5F55" }), _jsx("button", { className: state.meeting.activeDocument === 'minutes' ? 'is-active' : '', type: "button", disabled: state.meeting.minutesFile === null, onClick: () => submitMeeting(send, 'select-minutes', {}, '正在切换会议纪要…'), children: "\u4F1A\u8BAE\u7EAA\u8981" }), _jsx("button", { type: "button", onClick: () => submitMeeting(send, 'toggle-reference', {}, '正在切换原文对照…'), children: state.meeting.referencePanelOpen ? '收起原文' : '查看原文' })] })] }), state?.meeting && _jsx(MeetingPanel, { state: state, send: send, docxPath: docxPath, setDocxPath: setDocxPath, sourceQuery: sourceQuery, setSourceQuery: setSourceQuery, sourceText: sourceText }), state?.document?.selectedNodeId && _jsx("div", { className: "dwb-node-editor", children: !editorOpen ? _jsx("button", { type: "button", onClick: () => { setEditTitle(state.document.selectedNodeTitle ?? ''); setEditContent(state.document.selectedNodeContent ?? ''); setEditorOpen(true); }, children: "\u7F16\u8F91\u5F53\u524D\u8282\u70B9" }) : _jsxs(_Fragment, { children: [_jsx("input", { value: editTitle, onChange: event => setEditTitle(event.target.value), "aria-label": "\u8282\u70B9\u6807\u9898" }), _jsx("textarea", { value: editContent, onChange: event => setEditContent(event.target.value), "aria-label": "\u8282\u70B9\u6B63\u6587" }), _jsx("button", { type: "button", onClick: () => { send({ type: 'edit-node', requestId: globalThis.crypto.randomUUID(), nodeId: state.document.selectedNodeId, title: editTitle, content: editContent, expectedRevision: state.document.revision }); setEditorOpen(false); }, children: "\u4FDD\u5B58\u5F53\u524D\u8282\u70B9" }), _jsx("button", { type: "button", onClick: () => setEditorOpen(false), children: "\u53D6\u6D88" })] }) }), _jsxs("div", { className: "dwb-row", children: [_jsx("label", { children: "\u573A\u666F" }), _jsxs("select", { value: state?.scene ?? 'meeting', onChange: event => send({ type: 'set-context', scene: event.target.value }), children: [_jsx("option", { value: "meeting", children: "\u4F1A\u8BAE\u6574\u7406" }), _jsx("option", { value: "project", children: "\u9879\u76EE\u66F4\u65B0" })] }), _jsx("span", { className: "dwb-meta", children: state?.targetBinding === 'error' ? '目标绑定异常，文档写入已禁用' : state?.document ? `版本 ${state.document.revision} · ${state.document.dirty ? '未保存' : '已保存'}` : state?.targetFile && state?.view?.connected === false ? '目标已设置，视图待连接' : '文档未绑定' })] }), _jsxs("div", { className: "dwb-row", children: [_jsx("label", { children: "\u6D4F\u89C8\u72B6\u6001" }), _jsx(FileCandidate, { state: state, connected: connected, pending: pending !== null, submit: submitContext }), _jsx("span", { className: "dwb-spacer" }), _jsx("label", { children: "\u89C6\u56FE" }), ['markdown', 'mindmap', 'table'].map(view => _jsx("button", { className: state?.view?.currentView === view ? 'is-active' : '', type: "button", onClick: () => send({ type: 'set-view', view }), children: view === 'markdown' ? 'Markdown' : view === 'mindmap' ? '思维导图' : '表格' }, view))] }), _jsxs("div", { className: "dwb-row", children: [_jsx("label", { children: "\u6574\u7406\u76EE\u6807" }), _jsx("input", { value: target, onChange: event => { setTarget(event.target.value); targetDirtyRef.current = true; }, placeholder: "\u5DE5\u4F5C\u533A\u5185\u7684 .md \u6587\u4EF6" }), _jsx("button", { type: "button", disabled: pending !== null || !connected, onClick: () => submitContext({ targetFile: target }, '正在设置整理目标…'), children: "\u56FA\u5B9A\u76EE\u6807" }), state?.targetFile && _jsx("button", { type: "button", disabled: pending !== null || !connected, onClick: () => submitContext({ targetFile: null }, '正在解除整理目标…'), children: "\u89E3\u9664" })] }), _jsxs("div", { className: "dwb-row", children: [_jsx("label", { children: "\u53C2\u8003\u6750\u6599" }), _jsx("input", { value: materialPath, onChange: event => setMaterialPath(event.target.value), placeholder: ".md / .txt / .json \u8DEF\u5F84" }), _jsx("button", { type: "button", disabled: pending !== null || !connected, onClick: () => submitContext({ addPath: materialPath }, '正在添加参考材料…', true), children: "\u6DFB\u52A0\u6587\u4EF6" }), _jsx("button", { type: "button", onClick: () => setPasteOpen(value => !value), children: "\u7C98\u8D34\u6587\u5B57" })] }), pasteOpen && _jsxs("div", { className: "dwb-paste", children: [_jsx("input", { value: pasteLabel, onChange: event => setPasteLabel(event.target.value), "aria-label": "\u6750\u6599\u540D\u79F0" }), _jsx("textarea", { value: pasteContent, onChange: event => setPasteContent(event.target.value), placeholder: "\u7C98\u8D34\u8F6C\u5199\u6587\u672C\u6216\u521D\u6B65\u7EAA\u8981" }), _jsx("button", { type: "button", disabled: !pasteContent.trim(), onClick: () => { send({ type: 'set-context', paste: { label: pasteLabel, content: pasteContent } }); setPasteContent(''); setPasteOpen(false); }, children: "\u4FDD\u5B58\u4E3A\u6750\u6599" })] }), (state?.materials.length ?? 0) > 0 && _jsx("div", { className: "dwb-materials", children: state?.materials.map(material => _jsxs("span", { className: "dwb-chip", title: material.path, children: [material.label, _jsx("button", { type: "button", "aria-label": `移除 ${material.label}`, onClick: () => send({ type: 'set-context', removeMaterialId: material.id }), children: "\u00D7" })] }, material.id)) }), state?.lastChange && _jsxs("div", { className: "dwb-change", children: [_jsxs("div", { children: [_jsx("strong", { children: "\u6700\u8FD1\u6539\u52A8" }), " \u00B7 \u7248\u672C ", state.lastChange.revision] }), _jsx("div", { children: changeText(state.lastChange) }), _jsx("button", { type: "button", disabled: state.targetBinding !== 'bound' || !state.document?.undoDepth, onClick: () => send({ type: 'undo' }), children: "\u64A4\u9500\u6574\u6B21\u4FEE\u6539" })] }), state && _jsxs("div", { className: "dwb-metrics", children: ["\u8017\u65F6\uFF1A\u9996\u6BB5\u6A21\u578B\u6587\u672C ", metric(state.metrics.firstModelTextMs), " \u00B7 \u6750\u6599\u8BFB\u53D6 ", metric(state.metrics.materialReadMs), " \u00B7 \u5DE5\u5177\u8F6E\u6B21 ", state.metrics.modelToolRounds, " \u00B7 \u6587\u6863\u63D0\u4EA4 ", metric(state.metrics.documentCommitMs), " \u00B7 \u89C6\u56FE\u5237\u65B0 ", metric(state.metrics.viewRefreshMs)] }), _jsxs("div", { className: "dwb-hints", children: ["\u53EF\u4EE5\u8BF4\uFF1A", state?.targetFile ? state.scene === 'project' ? '“把刚才确认的变化更新进去” · “用表格只看任务”' : '“把刚才讨论整理成纪要” · “用表格只看待办”' : '“把这份材料整理成会议纪要” · “把项目计划设为整理目标”'] })] })] }));
}
const DOCK_VALUES = ['always', 'auto', 'off'];
/** 分段控件的显示顺序与中文标签；默认高亮「按需」（F011）。 */
const DOCK_SEGMENTS = [
    { value: 'auto', label: '按需' },
    { value: 'always', label: '始终' },
    { value: 'off', label: '不显示' },
];
const DOCK_HINTS = {
    always: '任何会话都显示摘要栏；未使用工作台的会话仍不注入模型上下文。',
    auto: '只有已使用工作台（已有固定整理目标、参考材料或已打开会议）的会话显示摘要栏。',
    off: '任何会话都不显示摘要栏；工具、技能与模型上下文不受影响。',
};
function isDockValue(value) {
    return typeof value === 'string' && DOCK_VALUES.includes(value);
}
/** 当前生效值；namespace 尚未就绪或取值异常时按 schema 默认 `auto`。 */
function effectiveDock(snapshot) {
    return isDockValue(snapshot.value?.dock) ? snapshot.value.dock : 'auto';
}
/** 字段出现在 `user` 层即视为用户覆盖，即使取值与组装层相同。 */
function dockOverridden(snapshot) {
    return snapshot.user !== undefined && snapshot.user !== null && Object.prototype.hasOwnProperty.call(snapshot.user, 'dock');
}
/**
 * 设置页「插件 → 插件配置」的 `dock` 卡片（F010 语义 + F011 外观）。
 *
 * 配置语义仍是 F010 的草稿 + 保存：写入按 revision 栅栏走 `mutate`，清除该字段回退组装层。
 * 外观按宿主 `PluginCard` 的语法自绘（客户端纯度门禁禁止 import 它的值，因此逐类对齐而不是复用）：
 * 可折叠头部（名称 + 版本 + 副标题 + 覆盖徽标 + chevron）、带分隔线的设置行、行内右对齐的分段控件、
 * 右下角操作行。收起只隐藏主体，组件保持挂载，未保存草稿不因收起丢失。
 * namespace 未对本客户端服务时渲染为空，而不是渲染一张无法操作的卡。
 */
function DockSettingsCard({ scope }) {
    const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
    const [draft, setDraft] = useState(() => effectiveDock(scope.getSnapshot()));
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    // 展开是卡片的本地阅读状态：收起不卸载组件，因此草稿与栅栏都留在 state 里。
    const [open, setOpen] = useState(false);
    const dirtyRef = useRef(false);
    // 开始草拟时读取的 revision 作为固定栅栏：过期保存被拒绝，而不是覆盖并发修改。
    const fence = useRef(scope.getSnapshot().revision);
    const bodyId = `dwb-dock-settings-body-${SETTINGS_NAMESPACE}`;
    useEffect(() => {
        const sync = () => {
            const next = scope.getSnapshot();
            setSnapshot(next);
            if (!dirtyRef.current) {
                setDraft(effectiveDock(next));
                fence.current = next.revision;
            }
        };
        const stop = scope.subscribe(sync);
        sync();
        return stop;
    }, [scope]);
    if (snapshot.status === 'unavailable')
        return null;
    if (snapshot.status !== 'ready')
        return _jsx("section", { className: "dwb-card", children: _jsx("p", { className: "dwb-card-hint", children: "\u6B63\u5728\u8BFB\u53D6\u63D2\u4EF6\u8BBE\u7F6E\u2026" }) });
    const covered = dockOverridden(snapshot);
    const readonly = snapshot.writable === false;
    const commit = (operations, message) => {
        setBusy(true);
        setError('');
        setNotice('');
        void scope.mutate(operations, fence.current).then(() => {
            dirtyRef.current = false;
            setDirty(false);
            const next = scope.getSnapshot();
            fence.current = next.revision;
            setSnapshot(next);
            setDraft(effectiveDock(next));
            setNotice(message);
        }, (cause) => {
            setError(`保存失败：${cause instanceof Error ? cause.message : String(cause)}`);
        }).finally(() => setBusy(false));
    };
    const inherit = isDockValue(snapshot.base?.dock) ? snapshot.base.dock : 'auto';
    return _jsxs("section", { className: `dwb-card ${open ? 'is-open' : ''}`, children: [_jsxs("button", { className: "dwb-card-header", type: "button", "aria-expanded": open, "aria-controls": bodyId, onClick: () => setOpen(value => !value), children: [_jsxs("span", { className: "dwb-card-head-text", children: [_jsxs("span", { className: "dwb-card-name", children: ["Irving \u00B7 \u529E\u516C\u8BA8\u8BBA\u5DE5\u4F5C\u53F0", _jsxs("span", { className: "dwb-card-version", children: ["v", PLUGIN_VERSION] })] }), _jsx("span", { className: "dwb-card-subtitle", children: "\u6458\u8981\u680F\u663E\u793A\u7B56\u7565" })] }), _jsx("span", { className: `dwb-card-badge ${covered ? 'is-override' : ''}`, children: covered ? '用户覆盖' : '继承组装层' }), _jsx("svg", { className: "dwb-card-chevron", viewBox: "0 0 16 16", width: "16", height: "16", fill: "none", "aria-hidden": "true", focusable: "false", children: _jsx("path", { d: "m4 6 4 4 4-4", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }) })] }), _jsxs("div", { className: "dwb-card-body", id: bodyId, hidden: !open, children: [_jsxs("div", { className: "dwb-card-field", children: [_jsxs("div", { className: "dwb-card-field-text", children: [_jsx("span", { className: "dwb-card-field-label", children: "\u6458\u8981\u680F\u663E\u793A\u7B56\u7565" }), _jsx("span", { className: "dwb-card-field-desc", children: DOCK_HINTS[draft] })] }), _jsx("div", { className: "dwb-segmented", role: "group", "aria-label": "\u6458\u8981\u680F\u663E\u793A\u7B56\u7565", children: DOCK_SEGMENTS.map(segment => _jsx("button", { type: "button", className: `dwb-segment ${draft === segment.value ? 'is-active' : ''}`, "aria-pressed": draft === segment.value, disabled: busy || readonly, onClick: () => {
                                        dirtyRef.current = true;
                                        setDirty(true);
                                        setDraft(segment.value);
                                        setNotice('');
                                        setError('');
                                    }, children: segment.label }, segment.value)) })] }), _jsxs("p", { className: "dwb-card-meta", children: ["\u5F53\u524D\u751F\u6548\uFF1A", effectiveDock(snapshot), "\uFF08", covered ? `覆盖组装层 ${inherit}` : `组装层 ${inherit}`, "\uFF09\u3002\u8FD9\u91CC\u4FDD\u5B58\u5373\u65F6\u751F\u6548\uFF1B\u7EC4\u88C5\u5C42 ", _jsx("code", { children: "cordis.patch.yml" }), " \u7684\u6539\u52A8\u4ECD\u9700\u91CD\u8F7D\u63D2\u4EF6\u3002"] }), !readonly && dirty && _jsx("p", { className: "dwb-card-hint", children: "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\u3002" }), notice && _jsx("p", { className: "dwb-card-notice", role: "status", children: notice }), error && _jsx("p", { className: "dwb-card-error", role: "status", children: error }), _jsxs("div", { className: "dwb-card-footer", children: [_jsx("button", { className: "dwb-card-button", type: "button", disabled: busy || readonly || !covered, onClick: () => commit([{ op: 'unset', path: ['dock'] }], '已清除用户覆盖，回退到组装层配置。'), children: "\u6062\u590D\u7EC4\u88C5\u5C42" }), _jsx("button", { className: "dwb-card-button is-primary", type: "button", disabled: busy || readonly || !dirty, onClick: () => commit([{ op: 'set', path: ['dock'], value: draft }], '已保存，摘要栏策略立即生效（不需要重载插件）。'), children: "\u4FDD\u5B58" })] })] })] });
}
function submitMeeting(send, action, fields, _label) {
    send({ type: 'meeting-action', requestId: globalThis.crypto.randomUUID(), action, ...fields });
}
function MeetingPanel({ state, send, docxPath, setDocxPath, sourceQuery, setSourceQuery, sourceText }) {
    const meeting = state.meeting;
    const [info, setInfo] = useState(meeting.info);
    useEffect(() => setInfo(meeting.info), [meeting.info]);
    const readSource = () => {
        const source = state.materials[0];
        if (source === undefined)
            return;
        send({ type: 'read-source', requestId: globalThis.crypto.randomUUID(), materialId: source.id, query: sourceQuery });
    };
    return _jsxs(_Fragment, { children: [_jsxs("div", { className: "dwb-meeting-info", children: [_jsx("label", { children: "\u4E3B\u9898" }), _jsx("input", { value: info.topic, onChange: event => setInfo({ ...info, topic: event.target.value }), placeholder: "\u4F1A\u8BAE\u4E3B\u9898" }), _jsx("input", { value: info.date, onChange: event => setInfo({ ...info, date: event.target.value }), placeholder: "\u65E5\u671F YYYY-MM-DD" }), _jsx("input", { value: info.time, onChange: event => setInfo({ ...info, time: event.target.value }), placeholder: "\u65F6\u95F4" }), _jsx("input", { value: info.location, onChange: event => setInfo({ ...info, location: event.target.value }), placeholder: "\u5730\u70B9" }), _jsx("input", { value: info.attendees, onChange: event => setInfo({ ...info, attendees: event.target.value }), placeholder: "\u53C2\u4F1A\u4EBA" }), _jsx("input", { value: info.recorder, onChange: event => setInfo({ ...info, recorder: event.target.value }), placeholder: "\u8BB0\u5F55\u4EBA" }), _jsx("button", { type: "button", onClick: () => submitMeeting(send, 'save-info', { info }, '正在保存会议信息…'), children: "\u4FDD\u5B58\u4FE1\u606F" })] }), _jsxs("div", { className: "dwb-row", children: [_jsx("label", { children: "\u5BFC\u5165 DOCX" }), _jsx("input", { value: docxPath, onChange: event => setDocxPath(event.target.value), placeholder: "\u4F1A\u8BAE\u6587\u4EF6\u5939\u5185\u7684 .docx" }), _jsx("button", { type: "button", onClick: () => submitMeeting(send, 'import-docx', { docxPath }, '正在导入 DOCX…'), children: "\u8F6C\u6362\u5E76\u6DFB\u52A0" }), _jsx("button", { type: "button", disabled: meeting.minutesFile === null, onClick: () => submitMeeting(send, 'export-pdf', {}, '正在导出 PDF…'), children: "\u5BFC\u51FA PDF" })] }), meeting.referencePanelOpen && _jsxs("div", { className: "dwb-source", children: [_jsxs("div", { children: [_jsx("strong", { children: "\u539F\u6587\u5BF9\u7167" }), _jsx("input", { value: sourceQuery, onChange: event => setSourceQuery(event.target.value), placeholder: "\u8F93\u5165\u5173\u952E\u8BCD\u6216\u65F6\u95F4\u6233" }), _jsx("button", { type: "button", disabled: state.materials.length === 0, onClick: readSource, children: "\u663E\u793A\u539F\u6587" })] }), _jsx("pre", { children: sourceText || '选择参考材料后，可按关键词或时间戳查看原文。' })] })] });
}
function shortName(path) { return path?.split(/[\\/]/).at(-1) ?? ''; }
function samePath(left, right) {
    return typeof left === 'string' && typeof right === 'string' && left.replace(/\\/g, '/').toLowerCase() === right.replace(/\\/g, '/').toLowerCase();
}
function displayPath(path, root) {
    if (root !== null && root !== undefined) {
        const normalizedPath = path.replace(/\\/g, '/');
        const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
        if (normalizedPath.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`))
            return normalizedPath.slice(normalizedRoot.length + 1);
    }
    return path;
}
function FileCandidate({ state, connected, pending, submit }) {
    const browser = state?.browser;
    const hasContract = browser !== null && browser !== undefined && Object.prototype.hasOwnProperty.call(browser, 'fileCandidate');
    const candidate = hasContract ? browser?.fileCandidate ?? null : null;
    const source = browser?.fileCandidateSource === 'recent' ? '最近浏览' : '当前浏览';
    const extension = candidate?.match(/\.[^.\\/]+$/)?.[0].toLowerCase() ?? '';
    const targetAllowed = extension === '.md' || extension === '.markdown';
    const materialAllowed = targetAllowed || extension === '.txt' || extension === '.json';
    const isTarget = samePath(candidate, state?.targetFile);
    const isMaterial = state?.materials.some(item => samePath(item.path, candidate)) ?? false;
    const baseDisabled = !connected || browser?.connected !== true || candidate === null || pending;
    const reason = !connected ? '工作台已断线' : browser?.connected !== true ? '侧边栏未连接' : !hasContract ? '请升级侧边栏控制器；仍可使用下方路径输入' : candidate === null ? '请先打开或激活一个文件' : '';
    const formatReason = candidate !== null && !materialAllowed ? '该文件类型不能设为目标或材料' : candidate !== null && !targetAllowed ? 'TXT/JSON 只能添加为参考材料' : '';
    return _jsxs("div", { className: "dwb-file-candidate", title: candidate ?? reason, children: [_jsxs("span", { className: "dwb-meta", children: [_jsxs("strong", { children: [source, "\uFF1A"] }), candidate === null ? (reason || '未选择文件') : displayPath(candidate, browser?.workspaceRoot)] }), _jsx("button", { type: "button", disabled: baseDisabled || !targetAllowed || isTarget, title: reason || (!targetAllowed ? '整理目标仅支持 Markdown' : ''), onClick: () => submit({ targetFile: candidate }, '正在设置整理目标…'), children: isTarget ? '当前目标' : '设为整理目标' }), _jsx("button", { type: "button", disabled: baseDisabled || !materialAllowed || isMaterial, title: reason || (!materialAllowed ? '参考材料支持 Markdown、TXT 和 JSON' : ''), onClick: () => submit({ addPath: candidate }, '正在添加参考材料…'), children: isMaterial ? '已添加' : '添加为参考材料' }), formatReason && _jsx("span", { className: "dwb-file-reason", children: formatReason })] });
}
function metric(value) { return value === undefined ? '—' : `${value} ms`; }
function changeText(change) {
    if (change.action === 'undo')
        return '已恢复整次修改。';
    const counts = change.counts;
    return counts === undefined ? `已完成 ${change.action}。` : `新增 ${counts.added} 个、修改 ${counts.updated} 个、删除 ${counts.deleted} 个节点。`;
}
function injectStyle() {
    if (document.getElementById('dwb-style'))
        return;
    const style = document.createElement('style');
    style.id = 'dwb-style';
    style.textContent = `
.dwb-shell{--dwb-text:var(--dsw-alias-label-primary,#242933);--dwb-muted:var(--dsw-alias-label-secondary,#697180);--dwb-faint:var(--dsw-alias-label-tertiary,#9098a5);--dwb-accent:var(--dsw-alias-brand-primary,#4f6ef7);--dwb-border:var(--dsw-alias-border-l2,#e9ebef)}
.dwb-shell{box-sizing:border-box;width:calc(100% - 2 * var(--dsh-composer-side-clearance,16px));max-width:var(--dsh-composer-card-max-width,720px);min-width:0;margin:0 auto;font-size:12px;line-height:1.5;font-family:inherit;border:1px solid var(--dwb-border);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dwb-text);overflow:hidden;container-type:inline-size;container-name:dwb}
.dwb-shell *{box-sizing:border-box}
.dwb-summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto;width:100%;gap:14px;align-items:center;border:0;border-radius:11px;background:transparent;color:inherit;font:inherit;padding:9px 12px;text-align:left;cursor:pointer;transition:background-color .15s}
.dwb-summary:hover,.dwb-summary[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.06))}
.dwb-summary:focus-visible{outline:2px solid var(--dwb-accent);outline-offset:-2px}
.dwb-scene{display:inline-flex;gap:6px;align-items:center;min-width:0;padding:3px 8px;border-radius:7px;background:color-mix(in srgb,var(--dwb-accent) 9%,transparent);white-space:nowrap}
.dwb-scene-label{font-size:11px;color:var(--dwb-muted)}.dwb-scene-name{font-weight:600;color:var(--dwb-accent)}
.dwb-dot{width:6px;height:6px;border-radius:50%;background:var(--dwb-faint);flex:none}.dwb-dot.is-online{background:var(--dsw-alias-state-success-primary,#35a45b)}
.dwb-summary-details{display:flex;gap:12px;align-items:center;min-width:0}.dwb-summary-item{display:flex;gap:6px;align-items:center;min-width:0;flex:1}.dwb-summary-materials{flex:none}.dwb-summary-label{color:var(--dwb-muted);white-space:nowrap;flex:none}.dwb-summary-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.dwb-summary-value.is-empty{color:var(--dwb-faint);font-weight:400}.dwb-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;padding:0 5px;border-radius:5px;background:var(--dsw-alias-bg-layer-2,#f2f4f7);color:var(--dwb-muted);font-size:11px;font-variant-numeric:tabular-nums;line-height:20px}
.dwb-caret{display:flex;gap:4px;align-items:center;color:var(--dwb-muted);white-space:nowrap;font-size:11px}.dwb-chevron{flex:none;transition:transform .15s}.dwb-summary[aria-expanded="true"] .dwb-chevron{transform:rotate(180deg)}
@container dwb (max-width:580px){.dwb-summary{grid-template-columns:minmax(0,1fr) auto;gap:8px 12px}.dwb-scene{justify-self:start}.dwb-caret{grid-column:2;grid-row:1}.dwb-summary-details{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.dwb-summary-item{gap:5px}.dwb-summary-item+.dwb-summary-item{border-left:1px solid var(--dwb-border);padding-left:12px}}
@container dwb (max-width:420px){.dwb-summary-item{align-items:flex-start;flex-direction:column;gap:2px}.dwb-summary-label{font-size:11px}.dwb-summary-value{max-width:100%}.dwb-count{line-height:18px}}
@media(prefers-reduced-motion:reduce){.dwb-summary,.dwb-chevron{transition:none}}
.dwb-meta{opacity:.5}.dwb-panel{display:grid;gap:7px;padding:9px 12px;border-top:1px solid var(--dwb-border)}.dwb-row{display:flex;gap:6px;align-items:center}.dwb-row label{width:58px;opacity:.7}.dwb-row input{min-width:100px;flex:1}.dwb-row input,.dwb-row select,.dwb-paste input,.dwb-paste textarea{border:1px solid rgba(128,128,128,.35);border-radius:5px;background:transparent;color:inherit;padding:5px}.dwb-row button,.dwb-paste button,.dwb-change button{border:1px solid rgba(128,128,128,.35);border-radius:5px;background:transparent;color:inherit;padding:4px 8px;cursor:pointer}.dwb-row button.is-active{border-color:#4f6ef7;background:rgba(79,110,247,.12)}.dwb-spacer{flex:1}.dwb-paste{display:grid;grid-template-columns:150px 1fr auto;gap:6px}.dwb-paste textarea{min-height:54px;resize:vertical}.dwb-materials{display:flex;gap:5px;flex-wrap:wrap}.dwb-chip{background:rgba(79,110,247,.1);padding:3px 7px;border-radius:10px}.dwb-chip button{border:0;background:transparent;color:inherit;cursor:pointer;margin-left:4px}.dwb-task{padding:5px 10px;background:rgba(79,110,247,.09);border-top:1px solid rgba(128,128,128,.14)}.dwb-task.is-failed,.dwb-error{padding:5px 10px;background:rgba(220,50,50,.1);color:#b52828}.dwb-change{display:grid;grid-template-columns:1fr auto;gap:3px 8px;padding:7px;border:1px solid rgba(53,164,91,.25);border-radius:7px;background:rgba(53,164,91,.06)}.dwb-change div:nth-child(2){grid-column:1}.dwb-change button{grid-column:2;grid-row:1/3}.dwb-metrics,.dwb-hints{opacity:.65;border-top:1px solid rgba(128,128,128,.15);padding-top:6px}
.dwb-file-candidate{display:flex;align-items:center;gap:6px;min-width:0;flex:1}.dwb-file-candidate .dwb-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.8}.dwb-file-candidate button{white-space:nowrap;border:1px solid rgba(128,128,128,.35);border-radius:5px;background:transparent;color:inherit;padding:4px 8px;cursor:pointer}.dwb-file-reason{font-size:11px;opacity:.62;white-space:nowrap}.dwb-row button:disabled,.dwb-file-candidate button:disabled{cursor:not-allowed;opacity:.45}.dwb-notice{padding:5px 10px;background:rgba(53,164,91,.08);color:#287a43}@media(max-width:680px){.dwb-file-candidate{flex-wrap:wrap}.dwb-file-candidate .dwb-meta{flex-basis:100%}}
.dwb-meeting,.dwb-meeting-info{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:7px;border:1px solid rgba(79,110,247,.24);border-radius:7px}.dwb-meeting input{flex:1;min-width:180px}.dwb-meeting-info input{min-width:100px;flex:1}.dwb-meeting button,.dwb-meeting-info button,.dwb-source button{border:1px solid rgba(128,128,128,.35);border-radius:5px;background:transparent;color:inherit;padding:4px 8px;cursor:pointer}.dwb-meeting button.is-active{border-color:#4f6ef7;background:rgba(79,110,247,.12)}.dwb-source{border:1px solid rgba(128,128,128,.25);border-radius:7px;padding:7px}.dwb-source>div{display:flex;gap:6px;align-items:center}.dwb-source input{flex:1;min-width:120px}.dwb-source pre{max-height:260px;overflow:auto;white-space:pre-wrap;line-height:1.45;margin:7px 0 0;background:rgba(128,128,128,.06);padding:7px}
.dwb-node-editor{display:grid;grid-template-columns:1fr auto auto;gap:6px;border:1px solid rgba(53,164,91,.26);border-radius:7px;padding:7px}.dwb-node-editor input,.dwb-node-editor textarea{border:1px solid rgba(128,128,128,.35);border-radius:5px;background:transparent;color:inherit;padding:5px}.dwb-node-editor textarea{grid-column:1/-1;min-height:88px;resize:vertical}.dwb-node-editor button{border:1px solid rgba(128,128,128,.35);border-radius:5px;background:transparent;color:inherit;padding:4px 8px;cursor:pointer}
@container dwb (max-width:580px){.dwb-row{flex-wrap:wrap}.dwb-row label{flex:none}.dwb-row .dwb-spacer{display:none}.dwb-file-candidate{flex-basis:calc(100% - 70px);flex-wrap:wrap}.dwb-file-candidate .dwb-meta{flex-basis:100%}.dwb-file-reason{white-space:normal}.dwb-paste{grid-template-columns:minmax(0,1fr)}.dwb-paste input,.dwb-paste textarea{min-width:0;width:100%}.dwb-source>div{flex-wrap:wrap}.dwb-node-editor{grid-template-columns:minmax(0,1fr) auto}.dwb-node-editor input{grid-column:1/-1;min-width:0}}
.dwb-card{--dwb-card-text:var(--dsw-alias-label-primary,#242933);--dwb-card-muted:var(--dsw-alias-label-secondary,#697180);--dwb-card-faint:var(--dsw-alias-label-tertiary,#9098a5);--dwb-card-border:var(--dsw-alias-border-l2,#e9ebef);--dwb-card-strong:var(--dsw-alias-border-l4,#dcdfe5);--dwb-card-accent:var(--dsw-alias-brand-primary,#4f6ef7);display:flex;flex-direction:column;border:.5px solid var(--dwb-card-strong);border-radius:16px;background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dwb-card-text);list-style:none;transition:border-color .16s,background .16s}
.dwb-card *{box-sizing:border-box}
.dwb-card:hover{border-color:var(--dsw-alias-label-dimmed,rgba(128,128,128,.4))}
.dwb-card.is-open{background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-color:var(--dsw-alias-label-dimmed,rgba(128,128,128,.4))}
.dwb-card-header{display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;border:0;border-radius:12px;background:0 0;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dwb-card-header:focus-visible{outline:2px solid var(--dwb-card-accent);outline-offset:-2px}
.dwb-card-head-text{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
.dwb-card-name{display:flex;align-items:baseline;gap:6px;color:var(--dwb-card-text);font-size:15px;font-weight:600;line-height:1.4;min-width:0}
.dwb-card-version{color:var(--dwb-card-faint);font-size:12px;font-weight:400;white-space:nowrap}
.dwb-card-subtitle{color:var(--dwb-card-faint);font-size:13px;line-height:1.5}
.dwb-card-badge{flex:none;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#f2f4f7);color:var(--dwb-card-muted);font-size:11px;line-height:18px;white-space:nowrap}
.dwb-card-badge.is-override{background:color-mix(in srgb,var(--dwb-card-accent) 12%,transparent);color:var(--dwb-card-accent)}
.dwb-card-chevron{flex:none;color:var(--dwb-card-faint);transition:transform .16s}
.dwb-card-chevron.is-open,.dwb-card.is-open .dwb-card-chevron{transform:rotate(180deg)}
.dwb-card-body{display:flex;flex-direction:column;border-top:1px solid var(--dwb-card-border);margin:0 16px;padding-bottom:8px}
.dwb-card-body[hidden]{display:none}
.dwb-card-field{display:flex;align-items:center;gap:12px;padding:12px 0;min-width:0}
.dwb-card-field+.dwb-card-field{border-top:1px solid var(--dwb-card-border)}
.dwb-card-field-text{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}
.dwb-card-field-label{color:var(--dwb-card-text);font-size:13px;line-height:20px;font-weight:500}
.dwb-card-field-desc{color:var(--dwb-card-faint);font-size:12px;line-height:18px}
.dwb-segmented{display:inline-flex;flex:none;gap:0;padding:2px;border:1px solid var(--dwb-card-strong);border-radius:8px;background:transparent}
.dwb-segment{border:0;border-radius:6px;background:transparent;color:var(--dwb-card-muted);font:inherit;font-size:12px;line-height:18px;padding:3px 10px;cursor:pointer;white-space:nowrap}
.dwb-segment:hover:not(:disabled){color:var(--dwb-card-text)}
.dwb-segment.is-active{background:var(--dsw-alias-bg-layer-2,#f2f4f7);color:var(--dwb-card-text);font-weight:600}
.dwb-segment:focus-visible{outline:2px solid var(--dwb-card-accent);outline-offset:-2px}
.dwb-segment:disabled{cursor:not-allowed;opacity:.45}
.dwb-card-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;border-top:1px solid var(--dwb-card-border);padding:12px 0 4px;margin-top:12px}
.dwb-card-button{border:1px solid var(--dwb-card-border);border-radius:8px;background:0 0;color:var(--dwb-card-muted);font:inherit;font-size:13px;line-height:1.5;padding:5px 14px;cursor:pointer}
.dwb-card-button:hover:not(:disabled){color:var(--dwb-card-text);border-color:var(--dsw-alias-label-dimmed,rgba(128,128,128,.4))}
.dwb-card-button.is-primary{border-color:transparent;background:var(--dwb-card-text);color:var(--dsw-alias-bg-layer-3,#fff)}
.dwb-card-button:disabled{cursor:not-allowed;opacity:.4}
.dwb-card-button:focus-visible{outline:2px solid var(--dwb-card-accent);outline-offset:1px}
.dwb-card-hint,.dwb-card-meta{margin:0;color:var(--dwb-card-faint);font-size:12px;line-height:18px}
.dwb-card-hint{padding-top:6px}
.dwb-card-meta{color:var(--dwb-card-muted)}
.dwb-card-meta code{font-family:ui-monospace,Consolas,monospace}
.dwb-card-notice{margin:0;padding-top:6px;color:var(--dsw-alias-state-success-primary,#35a45b);font-size:12px;line-height:18px}
.dwb-card-error{margin:0;padding-top:6px;color:var(--dsw-alias-state-error-primary,#dc2626);font-size:12px;line-height:18px}
@container dwb (max-width:520px){.dwb-card-field{flex-wrap:wrap}.dwb-card-field-text{flex-basis:100%}.dwb-segmented{flex-wrap:wrap;max-width:100%}.dwb-card-header{flex-wrap:wrap;gap:8px 12px}.dwb-card-head-text{flex-basis:100%}}
@media(prefers-reduced-motion:reduce){.dwb-card,.dwb-card-chevron{transition:none}}
`;
    document.head.appendChild(style);
}
