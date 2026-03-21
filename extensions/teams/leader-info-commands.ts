import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { sanitizeName } from "./names.js";
import { getTeamDir, getTeamsRootDir } from "./paths.js";
import type { TeammateRpc } from "./teammate-rpc.js";
import type { TeamConfig, TeamMember } from "./team-config.js";
import type { ActivityTracker } from "./activity-tracker.js";
import type { TeamTask } from "./task-store.js";
import type { TeamsStyle } from "./teams-style.js";
import { formatMemberDisplayName, getTeamsStrings } from "./teams-style.js";
import {
	formatDuration,
	getMemberModel,
	isStalled,
	isStallWarning,
	resolveStatus,
	stateElapsedMs,
	summarizeLastAssistant,
	toolActivity,
} from "./teams-ui-shared.js";

export async function handleTeamListCommand(opts: {
	ctx: ExtensionCommandContext;
	teammates: Map<string, TeammateRpc>;
	getTeamConfig: () => TeamConfig | null;
	getTracker: () => ActivityTracker;
	getTasks: () => TeamTask[];
	style: TeamsStyle;
	refreshTasks: () => Promise<void>;
	renderWidget: () => void;
}): Promise<void> {
	const { ctx, teammates, getTeamConfig, getTracker, getTasks, style, refreshTasks, renderWidget } = opts;
	const strings = getTeamsStrings(style);

	await refreshTasks();

	const teamConfig = getTeamConfig();
	const tracker = getTracker();
	const tasks = getTasks();
	const cfgWorkers = (teamConfig?.members ?? []).filter((m) => m.role === "worker");
	const cfgByName = new Map<string, TeamMember>();
	for (const m of cfgWorkers) cfgByName.set(m.name, m);

	const names = new Set<string>();
	for (const name of teammates.keys()) names.add(name);
	for (const name of cfgByName.keys()) names.add(name);

	if (names.size === 0) {
		ctx.ui.notify(`No ${strings.memberTitle.toLowerCase()}s`, "info");
		renderWidget();
		return;
	}

	const lines: string[] = [];
	for (const name of Array.from(names).sort()) {
		const rpc = teammates.get(name);
		const cfg = cfgByName.get(name);
		const status = resolveStatus(rpc, cfg);
		const activity = tracker.get(name);
		const model = getMemberModel(cfg);
		const stalled = rpc ? isStalled(tracker, name) : false;
		const stalledInStatus = isStallWarning(stalled, status);

		// Line 1: name + status + time-in-state
		const elapsed = formatDuration(stateElapsedMs(activity));
		const activityLabel = toolActivity(activity.currentToolName);
		const statusStr = stalledInStatus ? `STALLED (${elapsed})` : `${status} (${elapsed})`;
		const parts = [`${formatMemberDisplayName(style, name)}: ${statusStr}`];

		if (activityLabel) parts.push(`  activity: ${activityLabel}`);

		// Active task
		const activeTask = tasks.find((t) => t.owner === name && t.status === "in_progress");
		if (activeTask) parts.push(`  task: #${activeTask.id} ${activeTask.subject}`);

		// Model
		if (model) parts.push(`  model: ${model}`);

		// Last message summary
		const lastMsg = summarizeLastAssistant(rpc, 100);
		if (lastMsg) parts.push(`  last: ${lastMsg}`);

		lines.push(parts.join("\n"));
	}

	ctx.ui.notify(lines.join("\n\n"), "info");
	renderWidget();
}

export async function handleTeamStatusCommand(opts: {
	ctx: ExtensionCommandContext;
	name: string;
	teammates: Map<string, TeammateRpc>;
	getTeamConfig: () => TeamConfig | null;
	getTracker: () => ActivityTracker;
	getTasks: () => TeamTask[];
	style: TeamsStyle;
}): Promise<void> {
	const { ctx, name, teammates, getTeamConfig, getTracker, getTasks, style } = opts;
	const teamConfig = getTeamConfig();
	const tracker = getTracker();
	const tasks = getTasks();

	const rpc = teammates.get(name);
	const cfg = (teamConfig?.members ?? []).find((m) => m.name === name);

	if (!rpc && !cfg) {
		ctx.ui.notify(`${formatMemberDisplayName(style, name)} not found`, "error");
		return;
	}

	const status = resolveStatus(rpc, cfg);
	const activity = tracker.get(name);
	const model = getMemberModel(cfg);
	const stalled = rpc ? isStalled(tracker, name) : false;
	const elapsed = formatDuration(stateElapsedMs(activity));
	const stalledStr = isStallWarning(stalled, status) ? " ⚠ STALLED" : "";
	const ownedTasks = tasks.filter((t) => t.owner === name);
	const activeTask = ownedTasks.find((t) => t.status === "in_progress");
	const pendingCount = ownedTasks.filter((t) => t.status === "pending").length;
	const completedCount = ownedTasks.filter((t) => t.status === "completed").length;
	const lastMsg = summarizeLastAssistant(rpc, 100);
	const actLabel = toolActivity(activity.currentToolName);

	const lines: string[] = [
		`${formatMemberDisplayName(style, name)}${stalledStr}`,
		`  status: ${status} (${elapsed} in state)`,
	];

	if (actLabel) lines.push(`  activity: ${actLabel}`);
	else if (status === "streaming") lines.push("  activity: thinking…");
	else lines.push("  activity: waiting for task");

	if (activeTask) lines.push(`  active task: #${activeTask.id} ${activeTask.subject}`);
	lines.push(`  tasks: ${pendingCount} pending, ${completedCount} completed`);
	if (model) lines.push(`  model: ${model}`);
	lines.push(`  tokens: ${activity.totalTokens}`);
	lines.push(`  turns: ${activity.turnCount}`);
	lines.push(`  tools used: ${activity.toolUseCount}`);
	if (lastMsg) lines.push(`  last message: ${lastMsg}`);

	ctx.ui.notify(lines.join("\n"), "info");
}

export async function handleTeamIdCommand(opts: {
	ctx: ExtensionCommandContext;
	teamId: string;
	taskListId: string | null;
	leadName: string;
	style: TeamsStyle;
}): Promise<void> {
	const { ctx, teamId, taskListId, leadName, style } = opts;
	const sessionTeamId = ctx.sessionManager.getSessionId();
	const effectiveTlId = taskListId ?? teamId;
	const teamsRoot = getTeamsRootDir();
	const teamDir = getTeamDir(teamId);

	ctx.ui.notify(
		[
			`teamId: ${teamId}`,
			...(teamId !== sessionTeamId ? [`sessionTeamId: ${sessionTeamId}`] : []),
			`taskListId: ${effectiveTlId}`,
			`leadName: ${leadName}`,
			`style: ${style}`,
			`teamsRoot: ${teamsRoot}`,
			`teamDir: ${teamDir}`,
		].join("\n"),
		"info",
	);
}

export async function handleTeamEnvCommand(opts: {
	ctx: ExtensionCommandContext;
	rest: string[];
	teamId: string;
	taskListId: string | null;
	leadName: string;
	style: TeamsStyle;
	getTeamsExtensionEntryPath: () => string | null;
	shellQuote: (v: string) => string;
}): Promise<void> {
	const { ctx, rest, teamId, taskListId, leadName, style, getTeamsExtensionEntryPath, shellQuote } = opts;

	const nameRaw = rest[0];
	if (!nameRaw) {
		ctx.ui.notify("Usage: /team env <name>", "error");
		return;
	}

	const name = sanitizeName(nameRaw);
	const effectiveTlId = taskListId ?? teamId;
	const teamsRoot = getTeamsRootDir();
	const teamDir = getTeamDir(teamId);
	const autoClaim = (process.env.PI_TEAMS_DEFAULT_AUTO_CLAIM ?? "1") === "1" ? "1" : "0";

	const teamsEntry = getTeamsExtensionEntryPath();
	const piCmd = teamsEntry ? `pi --no-extensions -e ${shellQuote(teamsEntry)}` : "pi";

	const env: Record<string, string> = {
		PI_TEAMS_ROOT_DIR: teamsRoot,
		PI_TEAMS_WORKER: "1",
		PI_TEAMS_TEAM_ID: teamId,
		PI_TEAMS_TASK_LIST_ID: effectiveTlId,
		PI_TEAMS_AGENT_NAME: name,
		PI_TEAMS_LEAD_NAME: leadName,
		PI_TEAMS_STYLE: style,
		PI_TEAMS_AUTO_CLAIM: autoClaim,
	};

	const exportLines = Object.entries(env)
		.map(([k, v]) => `export ${k}=${shellQuote(v)}`)
		.join("\n");

	const oneLiner = Object.entries(env)
		.map(([k, v]) => `${k}=${shellQuote(v)}`)
		.join(" ")
		.concat(` ${piCmd}`);

	ctx.ui.notify(
		[
			`teamId: ${teamId}`,
			`taskListId: ${effectiveTlId}`,
			`leadName: ${leadName}`,
			`teamsRoot: ${teamsRoot}`,
			`teamDir: ${teamDir}`,
			"",
			"Env (copy/paste):",
			exportLines,
			"",
			"Run:",
			oneLiner,
		].join("\n"),
		"info",
	);
}
