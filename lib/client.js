/**
 * dsh-usage — browser half (v0.2 redesign).
 *
 * Design principles: restrained, minimal, modern, techy. The differentiator
 * is "everything is customizable": every feature is a WIDGET with two
 * expressions —
 *   - detail (the panel card: full data + controls), and
 *   - compact (the bottom-left floating dock row: one glanceable line).
 * Each widget can be pinned to the dock, collapsed, hidden, or reordered.
 * The theme engine customizes accent color, background color, and panel
 * opacity; settings persist in localStorage.
 *
 * Hand-written `__ModuleLoader__` bundle (no build step). The slot runtime
 * injects `wide` and `t`; the plugin body registers dictionaries and the
 * `sidebar.footer.action` slot.
 */
window.__ModuleLoader__.load({
	id: "dsh-usage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		const NS = "dsh-usage";

		//#region css
		const css = [
			// floating dock (persistent, bottom-left, raised above the sidebar settings): one frame, divider rows, gear in the top-right corner
			".u_dock{position:fixed;left:14px;bottom:72px;z-index:30;display:flex;flex-direction:column;gap:6px;align-items:flex-start}",
			".u_dockFrame{position:relative;box-sizing:border-box;width:100%;min-width:176px;max-width:264px;padding:32px 14px 8px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--u-bg,var(--dsw-alias-bg-base));box-shadow:var(--dsw-shadow-lv2);display:flex;flex-direction:column}",
			".u_dockItem{display:flex;align-items:center;gap:8px;padding:7px 0;border:none;background:0 0;cursor:pointer;font:inherit;text-align:left;color:inherit;width:100%}",
			".u_dockItem:hover .u_floatValue{color:var(--dsw-alias-label-primary)}",
			".u_dockDivider{height:1px;background:var(--dsw-alias-border-l1);flex:none}",
			".u_dockSettings{position:absolute;top:8px;right:10px;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0}",
			".u_dockSettings:hover{color:var(--u-accent,#1f6feb)}",
			".u_dockRefresh{position:absolute;top:8px;right:36px;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0}",
			".u_dockRefresh:hover{color:var(--u-accent,#1f6feb)}",
			".u_dockGrip{position:absolute;top:8px;left:10px;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:5px;border:none;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:grab;padding:0;touch-action:none}",
			".u_dockGrip:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}",
			".u_dockGrip:active{cursor:grabbing}",
			// rail mode: a single rounded-rect balance pill, centered on the
			// collapsed sidebar; clicking reveals the dock
			".u_railBtn{position:fixed;bottom:72px;z-index:30;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--u-bg,var(--dsw-alias-bg-base));box-shadow:var(--dsw-shadow-lv2);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:0;padding:3px 6px;transform:translateX(-50%);transition:transform .15s ease}",
			".u_railBtn:hover{transform:translateX(-50%) scale(1.05)}",
			".u_railLabel{color:var(--dsw-alias-label-secondary);font-size:9px;line-height:11px}",
			".u_railValue{color:var(--dsw-alias-label-primary);font-size:10px;font-weight:600;line-height:13px;font-variant-numeric:tabular-nums;max-width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".u_railValue[data-tone=ok]{color:var(--dsw-alias-state-success-primary)}",
			".u_railValue[data-tone=bad]{color:var(--dsw-alias-state-error-primary)}",
			".u_railScrim{position:fixed;inset:0;z-index:25;background:transparent}",
			".u_floatLabel{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}",
			".u_floatValue{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:18px;font-variant-numeric:tabular-nums;margin-left:auto;transition:color .15s ease}",
			".u_floatValue[data-tone=ok]{color:var(--dsw-alias-state-success-primary)}",
			".u_floatValue[data-tone=accent]{color:var(--u-accent,#1f6feb)}",
			".u_floatValue[data-tone=warn]{color:var(--dsw-alias-state-warning-primary,#d29922)}",
			".u_floatValue[data-tone=bad]{color:var(--dsw-alias-state-error-primary)}",
			// week mini cells (compact heat)
			".u_weekMini{display:flex;gap:2px;align-items:center}",
			".u_weekCell{width:10px;height:10px;border-radius:3px;background:var(--dsw-alias-fill-l2)}",
			// detail panel
			".u_panel{z-index:40;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--u-bg,var(--dsw-alias-bg-base));width:400px;max-width:calc(100vw - 24px);max-height:78vh;box-shadow:var(--dsw-shadow-lv2);border-radius:12px;flex-direction:column;display:flex;position:fixed;bottom:12px;left:12px;overflow:hidden}",
			".u_header{box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);background:0 0;flex:none;justify-content:space-between;align-items:center;min-height:44px;padding:10px 12px;display:flex}",
			".u_headerLeft{align-items:center;gap:8px;display:flex}",
			".u_title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}",
			".u_headerActions{align-items:center;gap:2px;display:flex}",
			".u_iconButton{cursor:pointer;width:26px;height:26px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:6px;justify-content:center;align-items:center;padding:0;display:inline-flex}",
			".u_iconButton:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}",
			".u_iconButton[data-active]{color:var(--u-accent,#1f6feb);background:color-mix(in srgb,var(--u-accent,#1f6feb) 12%,transparent)}",
			".u_body{flex:1;min-height:0;padding:4px 14px 14px;overflow-y:auto}",
			".u_note{color:var(--dsw-alias-label-tertiary);margin:4px 0;font-size:12px;line-height:18px}",
			// theme customizer
			".u_themeBox{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px;margin-bottom:10px;display:flex;flex-direction:column;gap:8px}",
			".u_themeRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
			".u_themeLabel{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;min-width:44px}",
			".u_swatch{width:18px;height:18px;border-radius:50%;border:1px solid transparent;cursor:pointer;padding:0;box-sizing:border-box}",
			".u_swatch[data-active]{border-color:var(--dsw-alias-label-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--u-accent,#1f6feb) 40%,transparent)}",
			".u_swatchNull{background:conic-gradient(var(--dsw-alias-label-tertiary) 25%,var(--dsw-alias-fill-l2) 0 50%,var(--dsw-alias-label-tertiary) 0 75%,var(--dsw-alias-fill-l2) 0)}",
			".u_colorInput{width:26px;height:26px;border:none;background:0 0;cursor:pointer;padding:0}",
			".u_range{flex:1;min-width:80px;accent-color:var(--u-accent,#1f6feb)}",
			".u_reset{cursor:pointer;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;font:inherit;font-size:11px;line-height:16px;padding:0}",
			".u_reset:hover{color:var(--dsw-alias-label-primary)}",
			// widget cards (two-column grid; full-width cards span both)
			".u_grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:stretch}",
			".u_widget{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;transition:transform .22s cubic-bezier(.22,.61,.36,1)}",
			".u_widget[data-width=full]{grid-column:1/-1}",
			".u_widgetHead{display:flex;align-items:center;gap:2px;padding:3px 8px;background:color-mix(in srgb,var(--u-accent,#1f6feb) 4%,transparent)}",
			".u_ghost{border:1.5px dashed var(--dsw-alias-border-l2);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-fill-l2) 55%,transparent);min-height:56px;box-sizing:border-box;opacity:.9}",
			".u_widget[data-dragging]{opacity:.4;border-style:dashed}",
			".u_widgetTitle{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600;line-height:20px;cursor:pointer;text-align:left;background:0 0;border:none;font:inherit;padding:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".u_wIconBtn{cursor:pointer;width:22px;height:22px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:5px;justify-content:center;align-items:center;padding:0;display:inline-flex;flex:none}",
			".u_wIconBtn:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}",
			".u_wIconBtn[data-pinned]{color:var(--u-accent,#1f6feb)}",
			".u_wIconBtn:disabled{opacity:.35;cursor:default}",
			// action buttons appear only on hover (collapse arrow stays visible)
			".u_wHoverBtn{opacity:0;transition:opacity .15s ease}",
			".u_widget:hover .u_wHoverBtn{opacity:1}",
			".u_widget[dragging] .u_wHoverBtn,.u_widget:hover[dragging] .u_wHoverBtn{opacity:0}",
			".u_wBody{padding:8px 10px}",
			// balance detail
			".u_providerPicker{align-items:center;gap:8px;margin:0 0 8px;font-size:12px;line-height:18px;display:flex}",
			".u_providerPickerLabel{color:var(--dsw-alias-label-tertiary);flex:none}",
			".u_providerSelect{box-sizing:border-box;min-width:0;flex:1;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 6px;font:inherit;font-size:12px;line-height:18px}",
			".u_balanceGrid{display:flex;align-items:center;gap:14px}",
			".u_balanceLeft{display:flex;flex-direction:column;gap:2px;flex:none}",
			".u_balanceAmount{color:var(--u-accent,#1f6feb);font-size:32px;font-weight:600;line-height:38px;font-variant-numeric:tabular-nums}",
			".u_balanceStatus{align-items:center;gap:5px;font-size:12px;line-height:16px;display:inline-flex}",
			".u_balanceOk{color:var(--dsw-alias-state-success-primary)}",
			".u_balanceBad{color:var(--dsw-alias-state-error-primary)}",
			".u_balanceTable{display:grid;grid-template-columns:auto auto;column-gap:10px;row-gap:1px;margin-left:auto;font-size:12px;line-height:17px}",
			".u_balanceTableLabel{color:var(--dsw-alias-label-tertiary);text-align:right;white-space:nowrap}",
			".u_balanceTableValue{color:var(--dsw-alias-label-primary);font-weight:600;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}",
			".u_error{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);border-radius:8px;justify-content:space-between;align-items:flex-start;gap:8px;margin:4px 0;padding:7px 8px;font-size:12px;line-height:18px;display:flex}",
			".u_retry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0}",
			// stats detail
			".u_statBig{color:var(--dsw-alias-label-primary);font-size:22px;font-weight:600;line-height:28px;font-variant-numeric:tabular-nums}",
			".u_statBreak{display:flex;flex-wrap:wrap;gap:3px 10px;margin-top:3px}",
			".u_statBreakItem{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px;font-variant-numeric:tabular-nums;white-space:nowrap}",
			".u_statBreakItem b{color:var(--dsw-alias-label-secondary);font-weight:600}",
			".u_hitCaption{color:var(--dsw-alias-label-tertiary);margin-top:6px;font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}",
			".u_hitCaption b{color:var(--dsw-alias-label-secondary);font-weight:600}",
			// recent detail
			".u_days{flex-direction:column;display:flex;max-height:102px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-fill-l2) transparent}",
			".u_days::-webkit-scrollbar{width:4px}",
			".u_days::-webkit-scrollbar-thumb{background:var(--dsw-alias-fill-l2);border-radius:2px}",
			".u_day{width:100%;min-height:30px;align-items:center;gap:6px;border:0;background:0 0;border-bottom:1px solid var(--dsw-alias-border-l1);padding:5px 0;font:inherit;text-align:left;cursor:pointer;display:flex}",
			".u_day:last-child{border-bottom:0}",
			".u_day:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".u_dayDate{color:var(--dsw-alias-label-secondary);flex:none;width:50px;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;text-align:left}",
			".u_dayHit{color:var(--dsw-alias-label-tertiary);flex:none;width:54px;font-size:11px;line-height:18px;font-variant-numeric:tabular-nums;text-align:right}",
			".u_dayTokens{color:var(--dsw-alias-label-primary);flex:none;width:62px;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;text-align:right}",
			".u_dayBarTrack{display:block;flex:1;height:6px;border-radius:3px;background:var(--dsw-alias-fill-l2);overflow:hidden;margin-right:8px}",
			".u_dayBar{display:block;background:var(--u-accent,#1f6feb);border-radius:inherit;height:100%;min-width:3px;opacity:.75}",
			".u_detailHeader{align-items:center;gap:8px;display:flex}",
			".u_back{cursor:pointer;width:26px;height:26px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:6px;justify-content:center;align-items:center;padding:0;display:inline-flex;flex:none}",
			".u_back:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}",
			".u_detailDate{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600;line-height:18px}",
			".u_detailHit{color:var(--dsw-alias-label-tertiary);margin-left:auto;font-size:11px;line-height:18px;font-variant-numeric:tabular-nums}",
			".u_modelRow{flex-direction:column;gap:2px;margin:6px 0;display:flex}",
			".u_modelMeta{align-items:baseline;gap:8px;display:flex}",
			".u_modelName{color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px}",
			".u_modelTokens{color:var(--dsw-alias-label-primary);margin-left:auto;flex:none;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}",
			".u_modelHit{color:var(--dsw-alias-label-tertiary);flex:none;font-size:11px;line-height:18px;font-variant-numeric:tabular-nums}",
			".u_modelBarTrack{height:4px;background:var(--dsw-alias-fill-l2);border-radius:999px;overflow:hidden}",
			".u_modelBar{height:100%;background:var(--u-accent,#1f6feb);border-radius:inherit;opacity:.6}",
			// hidden manager
			".u_hiddenBox{border-top:1px solid var(--dsw-alias-border-l2);padding:8px 0 0}",
			".u_hiddenToggle{cursor:pointer;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;font:inherit;font-size:11px;line-height:16px;padding:0;display:flex;align-items:center;gap:4px}",
			".u_hiddenToggle:hover{color:var(--dsw-alias-label-primary)}",
			".u_hiddenRow{display:flex;align-items:center;gap:6px;padding:3px 0}",
			".u_hiddenName{flex:1;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}",
			".u_restore{cursor:pointer;color:var(--u-accent,#1f6feb);background:0 0;border:none;font:inherit;font-size:11px;line-height:16px;padding:0}",
			".u_footerNote{color:var(--dsw-alias-label-caption);margin:10px 0 0;font-size:10px;line-height:14px;font-variant-numeric:tabular-nums}",
			// activity heatmap (GitHub-style dots: 28 day columns × 6 four-hour rows)
			".u_heatBox{display:flex;flex-direction:column;gap:5px}",
			".u_heatCaption{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px;display:flex;justify-content:space-between;align-items:center}",
			".u_heatGrid{display:grid;grid-template-columns:22px repeat(28,1fr);gap:2px;align-items:center}",
			".u_heatMonths{display:grid;grid-template-columns:22px repeat(28,1fr);gap:2px;align-items:center;margin-bottom:-2px}",
			".u_heatMonthLabel{grid-column:auto;color:var(--dsw-alias-label-caption);font-size:9px;line-height:10px;text-align:left;overflow:visible;white-space:nowrap;font-variant-numeric:tabular-nums}",
			".u_heatHour{color:var(--dsw-alias-label-caption);font-size:9px;line-height:10px;text-align:right;padding-right:2px;font-variant-numeric:tabular-nums}",
			".u_heatCell{aspect-ratio:1/1;min-width:0;border-radius:2px;background:var(--dsw-alias-fill-l2)}",
			".u_heatToday{box-shadow:0 0 0 1px var(--dsw-alias-label-secondary)}",
			".u_heatLegend{display:flex;align-items:center;gap:3px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-caption)}",
			".u_heatLegendCell{width:10px;height:10px;border-radius:2px;background:var(--dsw-alias-fill-l2)}",
			// compact day activity strip (6 four-hour dots for today)
			".u_todayStrip{display:flex;gap:2px;align-items:center}",
			".u_todayStripCell{width:10px;height:10px;border-radius:3px;background:var(--dsw-alias-fill-l2)}",
			// dual channel comparison
			".u_dualRow{display:flex;align-items:center;gap:8px;margin:3px 0}",
			".u_dualDot{width:8px;height:8px;border-radius:2px;flex:none}",
			".u_dualName{flex:1;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}",
			".u_dualValue{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600;line-height:18px;font-variant-numeric:tabular-nums}",
			".u_dualSub{color:var(--dsw-alias-label-caption);font-size:10px;line-height:14px;font-variant-numeric:tabular-nums}",
			".u_dualBar{display:flex;height:6px;border-radius:3px;overflow:hidden;margin:8px 0 4px;background:var(--dsw-alias-fill-l2)}",
			".u_dualBarDsh{background:var(--u-accent,#1f6feb);height:100%}",
			".u_dualBarClaude{background:#7c3aed;height:100%}",
			".u_dualMini{display:flex;align-items:center;gap:3px}",
			".u_dualMiniBar{display:flex;width:44px;height:4px;border-radius:2px;overflow:hidden;background:var(--dsw-alias-fill-l2)}",
			".u_dualMiniDsh{background:var(--dsw-alias-label-secondary);height:100%}",
			".u_dualMiniClaude{background:var(--dsw-alias-label-tertiary);height:100%}"
		];
		if (typeof document !== "undefined" && typeof document.createElement === "function") {
			const style = document.createElement("style");
			style.textContent = css.join("");
			document.head.appendChild(style);
		}
		//#endregion

		//#region helpers
		function createLoader() {
			let seq = 0;
			return { start: () => ++seq, isCurrent: (s) => s === seq };
		}

		async function fetchJson(path) {
			const response = await fetch(path, { headers: { accept: "application/json" }, cache: "no-store" });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.json();
		}

		function interpolate(text, params) {
			if (params === void 0 || params === null) return text;
			return String(text).replace(/\{(\w+)\}/g, (match, key) => params[key] !== void 0 ? String(params[key]) : match);
		}

		function dayKeyOf(date) {
			const month = String(date.getMonth() + 1).padStart(2, "0");
			const day = String(date.getDate()).padStart(2, "0");
			return `${date.getFullYear()}-${month}-${day}`;
		}

		function todayKey() {
			return dayKeyOf(new Date());
		}

		function dayLabel(dateStr) {
			const parts = String(dateStr).split("-");
			return parts.length === 3 ? `${parts[1]}-${parts[2]}` : dateStr;
		}

		/** Thousands-separated integer. */
		function fmtTokens(value) {
			const n = Number(value);
			if (!Number.isFinite(n)) return String(value ?? "–");
			return n.toLocaleString("en-US");
		}

		/** Compact magnitude: 1.2k / 42.8M / 1.4B. */
		function fmtCompact(value) {
			const n = Number(value);
			if (!Number.isFinite(n)) return "–";
			if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
			if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
			if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
			return fmtTokens(n);
		}

		function currencySymbol(currency) {
			if (currency === "CNY" || currency === "RMB") return "¥";
			if (currency === "USD") return "$";
			if (currency === "EUR") return "€";
			if (typeof currency === "string" && currency !== "") return `${currency} `;
			return "";
		}

		function fmtCurrency(value, currency) {
			if (value === null || value === void 0) return "–";
			const n = Number(value);
			if (Number.isFinite(n) && String(value).trim() !== "") {
				return `${currencySymbol(currency)}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
			}
			return `${currencySymbol(currency)}${value}`;
		}

		function fmtHit(rate) {
			if (rate === null || rate === void 0) return "–";
			const n = Number(rate);
			if (!Number.isFinite(n)) return "–";
			return `${n}%`;
		}

		function statusTextOf(account, translate) {
			if (account === null || account === void 0) return translate("balance.loading");
			switch (account.status) {
				case "ok": return translate("status.ok");
				case "not-configured": return translate("balance.notConfigured", { ref: account.missingCredentials?.[0] ?? "" });
				case "unauthorized": return translate("balance.unauthorized");
				case "rate-limited": return translate("balance.rateLimited");
				case "unavailable": return translate("balance.unavailableStatus");
				case "invalid-response": return translate("balance.invalidResponse");
				case "unsupported": return translate("balance.unsupported");
				default: return translate("balance.loading");
			}
		}

		function defaultProviderId(list) {
			return list.find((provider) => provider.id === "deepseek-official")?.id
				?? list.find((provider) => provider.configured)?.id
				?? list[0]?.id
				?? null;
		}

		/** 5-level alpha ramp derived from the accent color (heat cells). */
		function heatAlpha(level) {
			return [0, 0.22, 0.42, 0.65, 1][level] ?? 0;
		}

		function heatColor(level) {
			const alpha = heatAlpha(level);
			return `color-mix(in srgb,var(--u-accent,#1f6feb) ${Math.round(alpha * 100)}%,transparent)`;
		}

		/** Neutral heat ramp for the floating dock (accent is reserved for balance). */
		function heatColorNeutral(level) {
			const alpha = heatAlpha(level) * 0.75;
			return `color-mix(in srgb,var(--dsw-alias-label-secondary,#64748b) ${Math.round(alpha * 100)}%,transparent)`;
		}

		/** Bucket a value into 5 heat levels (0–4) by max. */
		function heatLevel(value, max) {
			if (!(value > 0) || !(max > 0)) return 0;
			const ratio = value / max;
			if (ratio >= 0.8) return 4;
			if (ratio >= 0.5) return 3;
			if (ratio >= 0.25) return 2;
			return 1;
		}
		//#endregion

		//#region settings
		const SETTINGS_KEY = "dsh-usage:settings:v1";
		const ACCENT_PRESETS = ["#1f6feb", "#0ea5e9", "#7c3aed", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#64748b"];
		const BACKGROUND_PRESETS = [null, "#0d1117", "#f6f8fa"];
		/** Panel layout widths: half cards pair up two per row, full span both. */
		const WIDGET_WIDTH = { balance: "full", today: "half", month: "half", hit: "half", dual: "half", heatmap: "full", recent: "full" };
		/** Widgets that make no sense in the dock (pin button hidden). */
		const WIDGET_PINABLE = { heatmap: false, dual: false, recent: false };

		function defaultSettings() {
			return {
				theme: { accent: "#1f6feb", background: null, opacity: 1 },
				dockOffset: 72,
				order: ["balance", "today", "month", "hit", "dual", "recent", "heatmap"],
				widgets: {
					balance: { visible: true, collapsed: false, pinned: true },
					today: { visible: true, collapsed: false, pinned: true },
					month: { visible: true, collapsed: false, pinned: true },
					hit: { visible: true, collapsed: false, pinned: true },
					heatmap: { visible: true, collapsed: false, pinned: true },
					dual: { visible: true, collapsed: false, pinned: false },
					recent: { visible: true, collapsed: false, pinned: false }
				}
			};
		}

		function normalizeSettings(value) {
			const base = defaultSettings();
			if (value === null || typeof value !== "object") return base;
			return {
				theme: {
					accent: typeof value.theme?.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(value.theme.accent) ? value.theme.accent : base.theme.accent,
					background: typeof value.theme?.background === "string" && /^#[0-9a-fA-F]{6}$/.test(value.theme.background) ? value.theme.background : null,
					opacity: Number.isFinite(value.theme?.opacity) ? Math.min(1, Math.max(0.3, value.theme.opacity)) : base.theme.opacity
				},
				dockOffset: Number.isFinite(value.dockOffset) ? Math.min(800, Math.max(0, value.dockOffset)) : base.dockOffset,
				order: Array.isArray(value.order) && value.order.length > 0
				? [...new Set([
					...value.order.filter((id) => base.widgets[id] !== void 0),
					...base.order.filter((id) => !value.order.includes(id))
				])]
				: base.order,
				widgets: Object.fromEntries(Object.keys(base.widgets).map((id) => {
					const raw = value.widgets?.[id];
					return [id, {
						visible: raw?.visible !== false,
						collapsed: raw?.collapsed === true,
						pinned: raw?.pinned === true
					}];
				}))
			};
		}

		function loadSettings() {
			try {
				const raw = localStorage.getItem(SETTINGS_KEY);
				return raw === null ? defaultSettings() : normalizeSettings(JSON.parse(raw));
			} catch {
				return defaultSettings();
			}
		}

		function saveSettings(settings) {
			try {
				localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
			} catch {
				/* storage full or blocked — settings stay session-only */
			}
		}

		/** React hook: persisted settings + patch updater (object or updater fn). */
		function useSettings() {
			const [settings, setSettings] = react.useState(loadSettings);
			react.useEffect(() => {
				saveSettings(settings);
			}, [settings]);
			const update = react.useCallback((patch) => {
				setSettings((previous) => {
					if (typeof patch === "function") return patch(previous);
					return {
						...previous,
						...patch,
						theme: patch.theme !== void 0 ? { ...previous.theme, ...patch.theme } : previous.theme
					};
				});
			}, []);
			return [settings, update];
		}

		/** Move `id` to `beforeId`'s position (drag-reorder primitive). */
		function reorderWidget(settings, id, beforeId) {
			const order = [...settings.order];
			const from = order.indexOf(id);
			const to = order.indexOf(beforeId);
			if (from === -1 || to === -1 || from === to) return settings;
			order.splice(from, 1);
			order.splice(to, 0, id);
			return { ...settings, order };
		}

		/** Move an id inside the order array by a delta (-1 up, +1 down). */
		function moveOrder(settings, id, delta) {
			const index = settings.order.indexOf(id);
			const target = index + delta;
			if (index === -1 || target < 0 || target >= settings.order.length) return settings;
			const order = [...settings.order];
			[order[index], order[target]] = [order[target], order[index]];
			return { ...settings, order };
		}

		function toggleWidget(settings, id, key) {
			return {
				...settings,
				widgets: {
					...settings.widgets,
					[id]: { ...settings.widgets[id], [key]: !settings.widgets[id][key] }
				}
			};
		}
		//#endregion

		//#region locales
		const zh = {
			"panel.title": "用量 / 余额",
			"panel.updatedAt": "更新于 {time}",
			"action.refresh": "刷新",
			"action.retry": "重试",
			"action.close": "关闭",
			"action.back": "返回",
			"action.pin": "固定到悬浮窗",
			"action.unpin": "取消固定",
			"action.hide": "隐藏此项",
			"action.collapse": "折叠",
			"action.expand": "展开",
			"action.moveUp": "上移",
			"action.moveDown": "下移",
			"action.drag": "按住拖动排序",
			"action.dockDrag": "拖动调整位置",
			"action.customize": "自定义外观",
			"action.reset": "重置",
			"theme.accent": "主色",
			"theme.background": "背景",
			"theme.opacity": "不透明度",
			"theme.follow": "跟随主题",
			"hidden.count": "已隐藏 {count} 项",
			"hidden.restore": "恢复",
			"provider.label": "供应商",
			"status.ok": "正常",
			"widget.balance": "余额",
			"widget.today": "今日用量",
			"widget.month": "本月用量",
			"widget.hit": "缓存命中",
			"widget.heatmap": "活跃热力图",
			"widget.dual": "通道比例",
			"widget.recent": "用量记录",
			"dual.dsh": "DSH 通道",
			"dual.claude": "Claude Code",
			"dual.disabled": "未检测到 Claude Code 日志（~/.claude/projects）",
			"heat.caption": "近 28 天 · 每格 2 小时",
			"heat.today": "今日活跃",
			"balance.available": "可用余额",
			"balance.toppedUp": "充值余额",
			"balance.granted": "赠送余额",
			"balance.used": "已用",
			"balance.limit": "总额度",
			"balance.loading": "获取余额中…",
			"balance.notConfigured": "未配置 {ref}（编辑 ~/.dsh/.credentials.yaml）",
			"balance.unsupported": "该供应商无公开余额接口",
			"balance.unauthorized": "凭据无效",
			"balance.rateLimited": "查询被限流，稍后重试",
			"balance.unavailableStatus": "上游不可用",
			"balance.invalidResponse": "上游响应异常",
			"usage.input": "输入",
			"usage.output": "输出",
			"usage.cacheRead": "缓存读",
			"usage.cacheWrite": "缓存写",
			"usage.loading": "统计聚合中…",
			"usage.noData": "窗口内暂无用量数据",
			"usage.noModels": "当日无按模型数据",
			"usage.todayHit": "今日缓存命中率",
			"usage.totalHit": "累计缓存命中率"
		};
		const en = {
			"panel.title": "Usage / Balance",
			"panel.updatedAt": "Updated at {time}",
			"action.refresh": "Refresh",
			"action.retry": "Retry",
			"action.close": "Close",
			"action.back": "Back",
			"action.pin": "Pin to dock",
			"action.unpin": "Unpin",
			"action.hide": "Hide",
			"action.collapse": "Collapse",
			"action.expand": "Expand",
			"action.moveUp": "Move up",
			"action.moveDown": "Move down",
			"action.drag": "Drag to reorder",
			"action.dockDrag": "Drag to reposition",
			"action.customize": "Customize",
			"action.reset": "Reset",
			"theme.accent": "Accent",
			"theme.background": "Background",
			"theme.opacity": "Opacity",
			"theme.follow": "Follow theme",
			"hidden.count": "{count} hidden",
			"hidden.restore": "Restore",
			"provider.label": "Provider",
			"status.ok": "OK",
			"widget.balance": "Balance",
			"widget.today": "Today",
			"widget.month": "This month",
			"widget.hit": "Cache hit",
			"widget.heatmap": "Activity",
			"widget.dual": "Channel share",
			"widget.recent": "Usage log",
			"dual.dsh": "DSH channel",
			"dual.claude": "Claude Code",
			"dual.disabled": "No Claude Code logs found (~/.claude/projects)",
			"heat.caption": "Last 28 days · 2h cells",
			"heat.today": "Today's activity",
			"balance.available": "Available balance",
			"balance.toppedUp": "Topped up",
			"balance.granted": "Granted",
			"balance.used": "Used",
			"balance.limit": "Total credits",
			"balance.loading": "Fetching balance…",
			"balance.notConfigured": "{ref} is not configured (edit ~/.dsh/.credentials.yaml)",
			"balance.unsupported": "This provider has no public balance interface.",
			"balance.unauthorized": "The credential is invalid.",
			"balance.rateLimited": "Rate limited; retry later.",
			"balance.unavailableStatus": "Upstream unavailable.",
			"balance.invalidResponse": "Unexpected upstream response.",
			"usage.input": "Input",
			"usage.output": "Output",
			"usage.cacheRead": "Cache read",
			"usage.cacheWrite": "Cache write",
			"usage.loading": "Aggregating usage…",
			"usage.noData": "No usage inside the window.",
			"usage.noModels": "No per-model data for this day.",
			"usage.todayHit": "Today's cache hit rate",
			"usage.totalHit": "All-time cache hit rate"
		};
		//#endregion

		//#region small components
		function PinIcon(props) {
			return react_jsx_runtime.jsx("svg", {
				viewBox: "0 0 16 16",
				width: props.size ?? 12,
				height: props.size ?? 12,
				fill: "currentColor",
				"aria-hidden": true,
				children: react_jsx_runtime.jsx("path", { d: "M9.5 1.5 14.5 6.5 12 9l-1 5-3-3-3.5 3.5-1-1L7 10 4 7l5-1 2.5-2.5z" })
			});
		}

		/** Apple-style grabber: three horizontal lines (drag handle affordance). */
		function GripIcon(props) {
			return react_jsx_runtime.jsx("svg", {
				viewBox: "0 0 16 16",
				width: props.size ?? 12,
				height: props.size ?? 12,
				fill: "currentColor",
				"aria-hidden": true,
				children: react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
					children: [
						react_jsx_runtime.jsx("rect", { x: 3, y: 3, width: 10, height: 2, rx: 1 }),
						react_jsx_runtime.jsx("rect", { x: 3, y: 7, width: 10, height: 2, rx: 1 }),
						react_jsx_runtime.jsx("rect", { x: 3, y: 11, width: 10, height: 2, rx: 1 })
					]
				})
			});
		}

		/** Walk up from the dock node to the sidebar shell (class/tag heuristics). */
		function findSidebar(node) {
			let cursor = node?.parentElement ?? null;
			while (cursor !== null && cursor !== document.body && cursor !== document.documentElement) {
				const cls = cursor.className;
				if (typeof cls === "string" && (cls.includes("SidebarRoot") || cls.includes("sidebar"))) return cursor;
				if (cursor.tagName === "ASIDE" || cursor.tagName === "NAV") return cursor;
				cursor = cursor.parentElement;
			}
			return null;
		}

		function ProviderPicker({ providers, selected, onSelect, translate }) {
			if (providers.length === 0) return null;
			return react_jsx_runtime.jsxs("label", {
				className: "u_providerPicker",
				children: [
					react_jsx_runtime.jsx("span", { className: "u_providerPickerLabel", children: translate("provider.label") }),
					react_jsx_runtime.jsxs("select", {
						className: "u_providerSelect",
						value: selected ?? "",
						onChange: (event) => onSelect(event.target.value),
						children: providers.map((provider) => react_jsx_runtime.jsx("option", { value: provider.id, children: provider.displayName }, provider.id))
					})
				]
			});
		}

		function BalanceDetail({ account, translate, onRetry }) {
			if (account === null || account === void 0 || account.status === "pending") {
				return react_jsx_runtime.jsx("p", { className: "u_note", children: translate("balance.loading") });
			}
			if (account.mode === "unsupported" || account.scheme === null) {
				return react_jsx_runtime.jsx("p", { className: "u_note", children: translate("balance.unsupported") });
			}
			if (account.status === "not-configured") {
				return react_jsx_runtime.jsx("p", { className: "u_note", children: translate("balance.notConfigured", { ref: account.missingCredentials?.[0] ?? "" }) });
			}
			if (account.status !== "ok" || account.balance === null || account.balance === void 0) {
				return react_jsx_runtime.jsxs("div", {
					className: "u_error",
					children: [
						react_jsx_runtime.jsx("span", { children: translate("balance.invalidResponse") }),
						react_jsx_runtime.jsx("button", { type: "button", className: "u_retry", onClick: onRetry, children: translate("action.retry") })
					]
				});
			}
			const balance = account.balance;
			const rows = [
				{ label: translate("balance.available"), value: balance.total },
				{ label: translate("balance.toppedUp"), value: balance.toppedUp },
				{ label: translate("balance.granted"), value: balance.granted }
			].filter((row) => row.value !== null && row.value !== void 0);
			const positive = balance.isAvailable !== false;
			return react_jsx_runtime.jsxs("div", {
				className: "u_balanceGrid",
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "u_balanceLeft",
						children: [
							react_jsx_runtime.jsx("span", { className: "u_balanceAmount", children: fmtCurrency(balance.total, balance.currency) }),
							react_jsx_runtime.jsx("span", {
								className: positive ? "u_balanceStatus u_balanceOk" : "u_balanceStatus u_balanceBad",
								children: translate(positive ? "status.ok" : "balance.unavailableStatus")
							})
						]
					}),
					react_jsx_runtime.jsx("div", {
						className: "u_balanceTable",
						children: rows.flatMap((row) => [
							react_jsx_runtime.jsx("span", { className: "u_balanceTableLabel", children: row.label }, `l-${row.label}`),
							react_jsx_runtime.jsx("span", { className: "u_balanceTableValue", children: fmtCurrency(row.value, balance.currency) }, `v-${row.label}`)
						])
					})
				]
			});
		}

		function TokenBreakdown({ buckets, translate }) {
			const items = [
				[translate("usage.input"), buckets.inputTokens ?? 0],
				[translate("usage.output"), buckets.outputTokens ?? 0],
				[translate("usage.cacheRead"), buckets.cacheReadTokens ?? 0]
			];
			return react_jsx_runtime.jsx("div", {
				className: "u_statBreak",
				children: items.map(([label, value]) => react_jsx_runtime.jsxs("span", {
					className: "u_statBreakItem",
					children: [label, " ", react_jsx_runtime.jsx("b", { children: fmtCompact(value) })]
				}, label))
			});
		}

		function DayDetail({ day, onBack, translate }) {
			const models = Array.isArray(day?.models) ? day.models : [];
			const maxTokens = models.reduce((max, model) => Math.max(max, model.tokens ?? 0), 0);
			return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "u_detailHeader",
						children: [
							react_jsx_runtime.jsx("button", {
								type: "button",
								className: "u_back",
								"aria-label": translate("action.back"),
								onClick: onBack,
								children: react_jsx_runtime.jsx(primitives.IconChevronLeftOutline14, { size: 14 })
							}),
							react_jsx_runtime.jsx("span", { className: "u_detailDate", children: day.date }),
							react_jsx_runtime.jsx("span", { className: "u_detailHit", children: `${translate("widget.hit")} ${fmtHit(day.cacheHitRate)}` })
						]
					}),
					models.length === 0
						? react_jsx_runtime.jsx("p", { className: "u_note", children: translate("usage.noModels") })
						: models.map((model) => {
							const share = maxTokens > 0 ? Math.max((model.tokens ?? 0) / maxTokens * 100, 2) : 0;
							return react_jsx_runtime.jsxs("div", {
								className: "u_modelRow",
								children: [
									react_jsx_runtime.jsxs("div", {
										className: "u_modelMeta",
										children: [
											react_jsx_runtime.jsx("span", { className: "u_modelName", title: model.model, children: model.model }),
											react_jsx_runtime.jsx("span", { className: "u_modelTokens", children: fmtCompact(model.tokens ?? 0) }),
											react_jsx_runtime.jsx("span", { className: "u_modelHit", children: fmtHit(model.cacheHitRate) })
										]
									}),
									react_jsx_runtime.jsx("div", {
										className: "u_modelBarTrack",
										children: react_jsx_runtime.jsx("div", { className: "u_modelBar", style: { width: `${share}%` } })
									})
								]
							}, model.model);
						})
				]
			});
		}
		//#endregion

		//#region main component
		/**
		 * Sidebar footer action: floating dock + customizable detail panel.
		 * @param props - `wide` from the sidebar shell, `t` bound by the slot runtime.
		 */
		function UsagePanel({ wide, t }) {
			const translate = (key, params) => interpolate(t !== void 0 ? t(key) : key, params);
			const [settings, updateSettings] = useSettings();
			const [open, setOpen] = react.useState(false);
			const [dockOpen, setDockOpen] = react.useState(false);
			const [panelAnchor, setPanelAnchor] = react.useState(null);
			const [showCustomizer, setShowCustomizer] = react.useState(false);
			const [providers, setProviders] = react.useState([]);
			const [selectedProvider, setSelectedProvider] = react.useState(null);
			const [account, setAccount] = react.useState(null);
			const [accountLoading, setAccountLoading] = react.useState(false);
			const [accountError, setAccountError] = react.useState(null);
			const [usage, setUsage] = react.useState(null);
			const [usageError, setUsageError] = react.useState(null);
			const [selectedDay, setSelectedDay] = react.useState(null);
			const [refreshedAt, setRefreshedAt] = react.useState(null);
			const mountedRef = react.useRef(true);
			const usageLoaderRef = react.useRef(null);
			const accountLoaderRef = react.useRef(null);
			if (usageLoaderRef.current === null) usageLoaderRef.current = createLoader();
			if (accountLoaderRef.current === null) accountLoaderRef.current = createLoader();

			const loadProviders = react.useCallback(() => {
				fetchJson("/api/usage/providers").then((payload) => {
					if (!mountedRef.current) return;
					const list = payload?.ok === true && Array.isArray(payload.providers) ? payload.providers : [];
					setProviders(list);
					setSelectedProvider((previous) => previous ?? defaultProviderId(list));
				}).catch(() => { /* keep the previous list */ });
			}, []);

			const loadAccount = react.useCallback((providerId, force) => {
				if (providerId === null || providerId === void 0 || providerId === "") return;
				const seq = accountLoaderRef.current.start();
				setAccountLoading(true);
				setAccountError(null);
				fetchJson(`/api/usage/balance?provider=${encodeURIComponent(providerId)}${force ? "&refresh=1" : ""}`).then((payload) => {
					if (!mountedRef.current || !accountLoaderRef.current.isCurrent(seq)) return;
					setAccountLoading(false);
					if (payload?.ok !== true) {
						setAccount(null);
						setAccountError(payload?.message ?? "balance failed");
						return;
					}
					setAccount(payload.account ?? null);
				}).catch((error) => {
					if (!mountedRef.current || !accountLoaderRef.current.isCurrent(seq)) return;
					setAccountLoading(false);
					setAccountError(error instanceof Error ? error.message : String(error));
				});
			}, []);

			const loadUsage = react.useCallback(() => {
				const seq = usageLoaderRef.current.start();
				setUsageError(null);
				fetchJson("/api/usage/usage").then((payload) => {
					if (!mountedRef.current || !usageLoaderRef.current.isCurrent(seq)) return;
					if (payload?.ok !== true) {
						setUsageError(payload?.message ?? "usage failed");
						return;
					}
					setUsage(payload);
					setRefreshedAt(Date.now());
				}).catch((error) => {
					if (!mountedRef.current || !usageLoaderRef.current.isCurrent(seq)) return;
					setUsageError(error instanceof Error ? error.message : String(error));
				});
			}, []);

			react.useEffect(() => {
				mountedRef.current = true;
				loadProviders();
				loadUsage();
				return () => {
					mountedRef.current = false;
				};
			}, [loadProviders, loadUsage]);

			react.useEffect(() => {
				if (selectedProvider === null) return;
				loadAccount(selectedProvider, false);
			}, [selectedProvider, loadAccount]);

			react.useEffect(() => {
				const timer = setInterval(() => {
					if (selectedProvider !== null) loadAccount(selectedProvider, false);
					if (open) loadUsage();
				}, open ? 60000 : 300000);
				return () => clearInterval(timer);
			}, [open, selectedProvider, loadAccount, loadUsage]);

			const retry = () => {
				loadProviders();
				loadUsage();
				if (selectedProvider !== null) loadAccount(selectedProvider, true);
			};

			// Derived stats shared by several widgets.
			const stats = react.useMemo(() => {
				if (usage === null || !Array.isArray(usage.days)) return null;
				const today = todayKey();
				const month = today.slice(0, 7);
				const addBucket = (target, entry) => {
					target.inputTokens += Number(entry.inputTokens ?? 0) || 0;
					target.outputTokens += Number(entry.outputTokens ?? 0) || 0;
					target.cacheReadTokens += Number(entry.cacheReadTokens ?? 0) || 0;
					target.cacheWriteTokens += Number(entry.cacheWriteTokens ?? 0) || 0;
				};
				const dayBuckets = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
				const monthBuckets = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
				let totalTokensSum = 0;
				let todayHit = null;
				for (const day of usage.days) {
					totalTokensSum += Number(day.tokens ?? 0) || 0;
					if (day.date === today) {
						addBucket(dayBuckets, day);
						todayHit = day.cacheHitRate ?? null;
					}
					if (day.date.startsWith(month)) addBucket(monthBuckets, day);
				}
				const bucketTokens = (buckets) => buckets.inputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens;
				return {
					day: { ...dayBuckets, tokens: bucketTokens(dayBuckets) },
					month: { ...monthBuckets, tokens: bucketTokens(monthBuckets) },
					total: usage.total ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, tokens: totalTokensSum },
					todayHit,
					totalHit: usage.total?.cacheHitRate ?? null
				};
			}, [usage]);

			const recent = react.useMemo(() => {
				if (usage === null || !Array.isArray(usage.days)) return [];
				const cutoff = new Date();
				cutoff.setDate(cutoff.getDate() - 13);
				const cutoffKey = dayKeyOf(cutoff);
				const today = todayKey();
				return usage.days.filter((day) => day.date >= cutoffKey && day.date <= today && (Number(day.tokens ?? 0) || 0) > 0).reverse();
			}, [usage]);

			const dayMap = react.useMemo(() => {
				const map = new Map();
				if (usage !== null && Array.isArray(usage.days)) for (const day of usage.days) map.set(day.date, day);
				return map;
			}, [usage]);

			const selectedEntry = selectedDay !== null ? dayMap.get(selectedDay) ?? null : null;

			// Balance compact tone + value: green while healthy, red when the
			// account is out of credit or broken, neutral otherwise.
			const balanceCompact = (() => {
				if (accountLoading && account === null) return { value: "…", tone: null };
				if (account === null) return { value: accountError !== null ? "!" : "–", tone: accountError !== null ? "bad" : null };
				if (account.mode === "unsupported" || account.scheme === null) return { value: "–", tone: null };
				if (account.status === "not-configured") return { value: "–", tone: null };
				if (account.status !== "ok" || account.balance === null || account.balance === void 0) return { value: "!", tone: "bad" };
				if (account.balance.isAvailable === false) return { value: fmtCurrency(account.balance.total, account.balance.currency), tone: "bad" };
				return { value: fmtCurrency(account.balance.total, account.balance.currency), tone: "ok" };
			})();

			// Week mini cells for the recent compact (last 7 days incl. today).
			const weekCells = react.useMemo(() => {
				if (usage === null || !Array.isArray(usage.days)) return [];
				const today = todayKey();
				const days = usage.days.filter((day) => day.date <= today);
				const byDate = new Map(days.map((day) => [day.date, Number(day.tokens ?? 0) || 0]));
				const cells = [];
				const cursor = new Date();
				for (let i = 6; i >= 0; i -= 1) {
					const key = dayKeyOf(cursor);
					cells.push({ key, tokens: byDate.get(key) ?? 0 });
					cursor.setDate(cursor.getDate() - 1);
				}
				const max = Math.max(...cells.map((cell) => cell.tokens), 0);
				return cells.map((cell) => ({ ...cell, level: heatLevel(cell.tokens, max) }));
			}, [usage]);

			// Activity heatmap: last 28 day columns × 6 four-hour rows.
			const heatData = react.useMemo(() => {
				if (usage === null || !Array.isArray(usage.days)) return null;
				const byDate = new Map(usage.days.map((day) => [day.date, Array.isArray(day.hours) ? day.hours : []]));
				const days = [];
				const cursor = new Date();
				cursor.setDate(cursor.getDate() - 27);
				for (let i = 0; i < 28; i += 1) {
					days.push({ key: dayKeyOf(cursor), monthStart: cursor.getDate() === 1 });
					cursor.setDate(cursor.getDate() + 1);
				}
				let max = 0;
				for (const { key } of days) {
					const slots = byDate.get(key) ?? [];
					for (let h = 0; h < 24; h += 4) {
						const value = (slots[h] ?? 0) + (slots[h + 1] ?? 0) + (slots[h + 2] ?? 0) + (slots[h + 3] ?? 0);
						if (value > max) max = value;
					}
				}
				const today = todayKey();
				const rows = [];
				for (let r = 0; r < 6; r += 1) {
					rows.push(days.map(({ key }) => {
						const slots = byDate.get(key) ?? [];
						const value = (slots[r * 4] ?? 0) + (slots[r * 4 + 1] ?? 0) + (slots[r * 4 + 2] ?? 0) + (slots[r * 4 + 3] ?? 0);
						return { key, hour: r * 4, value, level: heatLevel(value, max) };
					}));
				}
				return { days, rows, max, today };
			}, [usage]);

			// Dual channel comparison (DSH sessions vs Claude Code JSONL logs).
			const dualData = react.useMemo(() => {
				if (usage === null) return null;
				const claude = usage.claude ?? null;
				const sumDays = (days, key) => (Array.isArray(days) ? days : [])
					.filter((day) => day.date === key || key.length === 7 && day.date.startsWith(key))
					.reduce((sum, day) => sum + (Number(day.tokens ?? 0) || 0), 0);
				const dshTotal = Number(usage.total?.tokens ?? 0) || 0;
				const claudeTotal = Number(claude?.total?.tokens ?? 0) || 0;
				const sum = dshTotal + claudeTotal;
				const today = todayKey();
				const month = today.slice(0, 7);
				return {
					enabled: claude !== null && claude.enabled === true,
					present: claude !== null,
					dshTotal,
					claudeTotal,
					dshPct: sum > 0 ? Math.round(dshTotal / sum * 100) : 0,
					claudePct: sum > 0 ? 100 - Math.round(dshTotal / sum * 100) : 0,
					dshToday: sumDays(usage.days, today),
					claudeToday: sumDays(claude?.days, today),
					dshMonth: sumDays(usage.days, month),
					claudeMonth: sumDays(claude?.days, month)
				};
			}, [usage]);

			const themeStyle = {
				"--u-accent": settings.theme.accent,
				...(settings.theme.background !== null ? { "--u-bg": settings.theme.background } : {}),
				opacity: settings.theme.opacity
			};

			// Dock sizing: track the sidebar shell so the dock always centers inside
			// it (equal gaps on both sides), aligned with the settings area below.
			const dockRef = react.useRef(null);
			const dockSettingsRef = react.useRef(null);
			const [dockMetrics, setDockMetrics] = react.useState(null);
			react.useEffect(() => {
				const dock = dockRef.current;
				if (dock === null) return void 0;
				const sidebar = findSidebar(dock);
				if (sidebar === null) return void 0;
				const measure = () => {
					const rect = sidebar.getBoundingClientRect();
					const style = getComputedStyle(sidebar);
					const padLeft = parseFloat(style.paddingLeft) || 0;
					const padRight = parseFloat(style.paddingRight) || 0;
					// Inset the dock by a fixed margin on both sides so it never
					// touches the sidebar edges.
					const margin = 20;
					const width = rect.width - padLeft - padRight - margin * 2;
					if (width > 0) setDockMetrics({ left: rect.left + padLeft + margin, width, centerX: rect.left + rect.width / 2 });
					else setDockMetrics({ left: 14, width: 0, centerX: rect.left + rect.width / 2 });
				};
				measure();
				if (typeof ResizeObserver !== "undefined") {
					const observer = new ResizeObserver(measure);
					observer.observe(sidebar);
					return () => observer.disconnect();
				}
				return void 0;
			}, []);

			const openPanel = (widgetId) => {
				setSelectedDay(null);
				setShowCustomizer(false);
				setOpen(true);
			};

			// Drag-to-reorder: while dragging, the layout stays PUT — only a dashed
			// ghost placeholder marks the drop slot (other cards glide aside via the
			// FLIP transition). The order commits once, on drop.
			const gridRef = react.useRef(null);
			const widgetRects = react.useRef(new Map());
			const dragIdRef = react.useRef(null);
			const dragStateRef = react.useRef(null);
			const [dragState, setDragState] = react.useState(null);
			react.useLayoutEffect(() => {
				const grid = gridRef.current;
				if (grid === null) return;
				const previous = widgetRects.current;
				const els = [...grid.querySelectorAll(".u_widget")];
				els.forEach((el) => {
					el.style.transition = "none";
					el.style.transform = "";
				});
				const next = new Map();
				for (const el of els) {
					const id = el.getAttribute("data-widget");
					if (id === null) continue;
					const rect = el.getBoundingClientRect();
					const old = previous.get(id);
					if (old !== void 0 && (old.left !== rect.left || old.top !== rect.top)) {
						el.style.transform = `translate(${old.left - rect.left}px, ${old.top - rect.top}px)`;
					}
					next.set(id, rect);
				}
				requestAnimationFrame(() => {
					for (const el of els) {
						el.style.transition = "transform .22s cubic-bezier(.22,.61,.36,1)";
						el.style.transform = "";
					}
				});
				widgetRects.current = next;
			});
			const onDragStart = (id) => (event) => {
				dragIdRef.current = id;
				dragStateRef.current = { id, overId: id };
				setDragState({ id, overId: id });
				const transfer = event.dataTransfer;
				if (transfer !== null && transfer !== void 0) {
					try {
						transfer.setData("text/plain", id);
						transfer.effectAllowed = "move";
					} catch {
						/* jsdom/older engines */
					}
				}
			};
			const onDragOver = (targetId) => (event) => {
				const dragged = dragIdRef.current;
				if (dragged === null) return;
				event.preventDefault();
				if (event.dataTransfer !== null && event.dataTransfer !== void 0) {
					try {
						event.dataTransfer.dropEffect = "move";
					} catch {
						/* ignore */
					}
				}
				const current = dragStateRef.current;
				if (current !== null && current.overId !== targetId) {
					const next = { id: dragged, overId: targetId };
					dragStateRef.current = next;
					setDragState(next);
				}
			};
			const onDragEnd = () => {
				const state = dragStateRef.current;
				if (state !== null && state.overId !== state.id) {
					updateSettings((previous) => reorderWidget(previous, state.id, state.overId));
				}
				dragStateRef.current = null;
				dragIdRef.current = null;
				setDragState(null);
			};

			// Dock vertical repositioning: press the top-left grip and drag;
			// the offset persists in settings.
			const dockDragRef = react.useRef(null);
			const onDockGripDown = (event) => {
				dockDragRef.current = { startY: event.clientY, startOffset: settings.dockOffset };
				try {
					event.currentTarget.setPointerCapture?.(event.pointerId);
				} catch {
					/* jsdom/older engines */
				}
			};
			const onDockGripMove = (event) => {
				const drag = dockDragRef.current;
				if (drag === null) return;
				const next = Math.min(800, Math.max(0, drag.startOffset + (drag.startY - event.clientY)));
				if (next !== settings.dockOffset) updateSettings({ dockOffset: next });
			};
			const onDockGripUp = () => {
				dockDragRef.current = null;
			};

			const toggleWidgetKey = (id, key) => updateSettings(toggleWidget(settings, id, key));

			const hiddenIds = settings.order.filter((id) => settings.widgets[id]?.visible === false);
			const visibleIds = settings.order.filter((id) => settings.widgets[id]?.visible !== false);
			// While dragging, a dashed ghost placeholder marks the drop slot; the
			// dragged card itself stays put (semi-transparent) until the drop.
			const GHOST_ID = "__ghost__";
			const displayIds = dragState === null
				? visibleIds
				: (() => {
					const list = [...visibleIds];
					const overIndex = list.indexOf(dragState.overId);
					if (overIndex !== -1) list.splice(overIndex, 0, GHOST_ID);
					return list;
				})();

			// Widget content factories (detail + compact expressions).
			const widgetContent = (id) => {
				switch (id) {
					case "balance":
						return {
							detail: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx(ProviderPicker, { providers, selected: selectedProvider, onSelect: setSelectedProvider, translate }),
									react_jsx_runtime.jsx(BalanceDetail, { account, translate, onRetry: retry })
								]
							}),
							compact: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_floatLabel", children: translate("widget.balance") }),
									react_jsx_runtime.jsx("span", { className: "u_floatValue", "data-tone": balanceCompact.tone, children: balanceCompact.value })
								]
							})
						};
					case "today":
						return {
							detail: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_statBig", children: fmtCompact(stats?.day.tokens ?? 0) }),
									stats !== null && react_jsx_runtime.jsx(TokenBreakdown, { buckets: stats.day, translate })
								]
							}),
							compact: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_floatLabel", children: translate("widget.today") }),
									react_jsx_runtime.jsx("span", { className: "u_floatValue", children: fmtCompact(stats?.day.tokens ?? 0) })
								]
							})
						};
					case "month":
						return {
							detail: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_statBig", children: fmtCompact(stats?.month.tokens ?? 0) }),
									stats !== null && react_jsx_runtime.jsx(TokenBreakdown, { buckets: stats.month, translate })
								]
							}),
							compact: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_floatLabel", children: translate("widget.month") }),
									react_jsx_runtime.jsx("span", { className: "u_floatValue", children: fmtCompact(stats?.month.tokens ?? 0) })
								]
							})
						};
					case "hit":
						return {
							detail: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_statBig", children: fmtHit(stats?.totalHit) }),
									react_jsx_runtime.jsx("p", {
										className: "u_hitCaption",
										children: react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
											children: [translate("usage.todayHit"), ": ", react_jsx_runtime.jsx("b", { children: fmtHit(stats?.todayHit) }), " · ", translate("usage.totalHit"), ": ", react_jsx_runtime.jsx("b", { children: fmtHit(stats?.totalHit) })]
										})
									})
								]
							}),
							compact: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_floatLabel", children: translate("widget.hit") }),
									react_jsx_runtime.jsx("span", { className: "u_floatValue", children: fmtHit(stats?.todayHit) })
								]
							})
						};
					case "heatmap":
						return {
							detail: () => heatData === null
								? react_jsx_runtime.jsx("p", { className: "u_note", children: translate("usage.noData") })
								: react_jsx_runtime.jsxs("div", {
									className: "u_heatBox",
									children: [
										react_jsx_runtime.jsxs("div", {
											className: "u_heatCaption",
											children: [
												react_jsx_runtime.jsx("span", { children: translate("heat.caption") }),
												react_jsx_runtime.jsxs("span", {
													className: "u_heatLegend",
													children: [1, 2, 3, 4].map((level) => react_jsx_runtime.jsx("span", {
														className: "u_heatLegendCell",
														style: { background: heatColor(level) }
													}, level))
												})
											]
										}),
										// Date labels above the columns (GitHub-style month marks).
										react_jsx_runtime.jsx("div", {
											className: "u_heatMonths",
											children: [
												react_jsx_runtime.jsx("span", { key: "corner" }),
												...heatData.days.map(({ key, monthStart }, index) => react_jsx_runtime.jsx("span", {
													className: "u_heatMonthLabel",
													children: monthStart || index === 0 ? dayLabel(key) : null
												}, key))
											]
										}),
										react_jsx_runtime.jsx("div", {
											className: "u_heatGrid",
											children: heatData.rows.map((cells) => {
												const hourLabel = String(cells[0].hour).padStart(2, "0");
												return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
													children: [
														react_jsx_runtime.jsx("span", { className: "u_heatHour", children: hourLabel }),
														...cells.map((cell) => react_jsx_runtime.jsx("span", {
															className: cell.key === heatData.today ? "u_heatCell u_heatToday" : "u_heatCell",
															style: cell.level > 0 ? { background: heatColor(cell.level) } : void 0,
															title: `${cell.key} ${hourLabel}:00–${String(cell.hour + 4).padStart(2, "0")}:00 · ${fmtTokens(cell.value)}`
														}, `${cell.key}-${cell.hour}`))
													]
												}, `row-${cells[0].hour}`);
											})
										})
									]
								}),
							compact: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_floatLabel", children: translate("heat.today") }),
									react_jsx_runtime.jsx("span", {
										className: "u_todayStrip",
										children: heatData === null
											? null
											: heatData.rows.map((cells) => {
												const cell = cells.find((entry) => entry.key === heatData.today) ?? { level: 0, value: 0 };
												return react_jsx_runtime.jsx("span", {
													className: "u_todayStripCell",
													style: cell.level > 0 ? { background: heatColorNeutral(cell.level) } : void 0,
													title: `${String(cell.hour ?? 0).padStart(2, "0")}:00 · ${fmtTokens(cell.value ?? 0)}`
												}, `today-${cell.hour ?? 0}`);
											})
									})
								]
							})
						};
					case "dual":
						return {
							detail: () => dualData === null || !dualData.present || !dualData.enabled
								? react_jsx_runtime.jsx("p", { className: "u_note", children: translate("dual.disabled") })
								: react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
									children: [
										react_jsx_runtime.jsxs("div", {
											className: "u_dualRow",
											children: [
												react_jsx_runtime.jsx("span", { className: "u_dualDot", style: { background: "var(--u-accent,#1f6feb)" } }),
												react_jsx_runtime.jsx("span", { className: "u_dualName", children: translate("dual.dsh") }),
												react_jsx_runtime.jsx("span", { className: "u_dualValue", children: `${fmtCompact(dualData.dshTotal)} · ${dualData.dshPct}%` })
											]
										}),
										react_jsx_runtime.jsxs("div", {
											className: "u_dualRow",
											children: [
												react_jsx_runtime.jsx("span", { className: "u_dualDot", style: { background: "#7c3aed" } }),
												react_jsx_runtime.jsx("span", { className: "u_dualName", children: translate("dual.claude") }),
												react_jsx_runtime.jsx("span", { className: "u_dualValue", children: `${fmtCompact(dualData.claudeTotal)} · ${dualData.claudePct}%` })
											]
										}),
										react_jsx_runtime.jsxs("div", {
											className: "u_dualBar",
											children: [
												react_jsx_runtime.jsx("div", { className: "u_dualBarDsh", style: { width: `${dualData.dshPct}%` } }),
												react_jsx_runtime.jsx("div", { className: "u_dualBarClaude", style: { width: `${dualData.claudePct}%` } })
											]
										})
									]
								}),
							compact: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_floatLabel", children: translate("widget.dual") }),
									dualData !== null && dualData.enabled
										? react_jsx_runtime.jsxs("span", {
											className: "u_dualMini",
											children: [
												react_jsx_runtime.jsx("span", { className: "u_floatValue", "data-tone": null, children: `${dualData.dshPct}%` }),
												react_jsx_runtime.jsxs("span", {
													className: "u_dualMiniBar",
													children: [
														react_jsx_runtime.jsx("span", { className: "u_dualMiniDsh", style: { width: `${dualData.dshPct}%` } }),
														react_jsx_runtime.jsx("span", { className: "u_dualMiniClaude", style: { width: `${dualData.claudePct}%` } })
													]
												}),
												react_jsx_runtime.jsx("span", { className: "u_floatValue", "data-tone": null, children: `${dualData.claudePct}%` })
											]
										})
										: react_jsx_runtime.jsx("span", { className: "u_floatValue", children: "–" })
								]
							})
						};
					case "recent":
						return {
							detail: () => selectedEntry !== null
								? react_jsx_runtime.jsx(DayDetail, { day: selectedEntry, onBack: () => setSelectedDay(null), translate })
								: recent.length === 0
									? react_jsx_runtime.jsx("p", { className: "u_note", children: translate("usage.noData") })
									: (() => {
										const maxRecentTokens = recent.reduce((max, day) => Math.max(max, Number(day.tokens ?? 0) || 0), 0);
										return react_jsx_runtime.jsx("div", {
											className: "u_days",
											children: recent.map((day) => {
												const share = maxRecentTokens > 0 ? Math.max((Number(day.tokens ?? 0) || 0) / maxRecentTokens * 100, 2) : 0;
												return react_jsx_runtime.jsxs("button", {
													type: "button",
													className: "u_day",
													onClick: () => setSelectedDay(day.date),
													children: [
														react_jsx_runtime.jsx("span", { className: "u_dayDate", children: dayLabel(day.date) }),
														react_jsx_runtime.jsx("span", { className: "u_dayHit", children: fmtHit(day.cacheHitRate) }),
														react_jsx_runtime.jsx("span", { className: "u_dayTokens", children: fmtCompact(day.tokens ?? 0) }),
														react_jsx_runtime.jsx("span", {
															className: "u_dayBarTrack",
															children: react_jsx_runtime.jsx("span", { className: "u_dayBar", style: { width: `${share}%` } })
														})
													]
												}, day.date);
											})
										});
									})(),
							compact: () => react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("span", { className: "u_floatLabel", children: translate("widget.recent") }),
									react_jsx_runtime.jsx("span", {
										className: "u_weekMini",
										children: weekCells.map((cell) => react_jsx_runtime.jsx("span", {
											className: "u_weekCell",
											style: { background: cell.level > 0 ? heatColorNeutral(cell.level) : void 0 },
											title: `${cell.key} ${fmtTokens(cell.tokens)}`
										}, cell.key))
									})
								]
							})
						};
					default:
						return { detail: () => null, compact: () => null };
				}
			};

			// Theme customizer row.
			const customizer = react_jsx_runtime.jsxs("div", {
				className: "u_themeBox",
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "u_themeRow",
						children: [
							react_jsx_runtime.jsx("span", { className: "u_themeLabel", children: translate("theme.accent") }),
							...ACCENT_PRESETS.map((color) => react_jsx_runtime.jsx("button", {
								type: "button",
								className: "u_swatch",
								"data-active": settings.theme.accent === color || void 0,
								style: { background: color },
								"aria-label": color,
								onClick: () => updateSettings({ theme: { accent: color } })
							}, color)),
							react_jsx_runtime.jsx("input", {
								type: "color",
								className: "u_colorInput",
								value: settings.theme.accent,
								"aria-label": translate("theme.accent"),
								onChange: (event) => updateSettings({ theme: { accent: event.target.value } })
							})
						]
					}),
					react_jsx_runtime.jsxs("div", {
						className: "u_themeRow",
						children: [
							react_jsx_runtime.jsx("span", { className: "u_themeLabel", children: translate("theme.background") }),
							...BACKGROUND_PRESETS.map((color, index) => react_jsx_runtime.jsx("button", {
								type: "button",
								className: color === null ? "u_swatch u_swatchNull" : "u_swatch",
								"data-active": settings.theme.background === color || void 0,
								style: color !== null ? { background: color } : void 0,
								"aria-label": color ?? translate("theme.follow"),
								title: color ?? translate("theme.follow"),
								onClick: () => updateSettings({ theme: { background: color } })
							}, `bg-${index}`)),
							react_jsx_runtime.jsx("input", {
								type: "color",
								className: "u_colorInput",
								value: settings.theme.background ?? "#1e1e1e",
								"aria-label": translate("theme.background"),
								onChange: (event) => updateSettings({ theme: { background: event.target.value } })
							})
						]
					}),
					react_jsx_runtime.jsxs("div", {
						className: "u_themeRow",
						children: [
							react_jsx_runtime.jsx("span", { className: "u_themeLabel", children: translate("theme.opacity") }),
							react_jsx_runtime.jsx("input", {
								type: "range",
								className: "u_range",
								min: 0.3,
								max: 1,
								step: 0.05,
								value: settings.theme.opacity,
								"aria-label": translate("theme.opacity"),
								onChange: (event) => updateSettings({ theme: { opacity: Number(event.target.value) } })
							}),
							react_jsx_runtime.jsx("button", {
								type: "button",
								className: "u_reset",
								onClick: () => updateSettings({ theme: { accent: ACCENT_PRESETS[0], background: null, opacity: 1 } }),
								children: translate("action.reset")
							})
						]
					})
				]
			});

			const updatedLabel = refreshedAt === null ? "" : translate("panel.updatedAt", {
				time: new Date(refreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
			});

			// Floating dock: one framed container, divider rows, gear in the corner.
			const pinnedIds = visibleIds.filter((id) => settings.widgets[id]?.pinned === true && WIDGET_PINABLE[id] !== false);

			const dock = react_jsx_runtime.jsx("div", {
				className: "u_dock",
				ref: dockRef,
				style: {
					...themeStyle,
					bottom: `${settings.dockOffset}px`,
					...(dockMetrics !== null && dockMetrics.width > 0 ? { left: `${dockMetrics.left}px`, width: `${dockMetrics.width}px` } : {})
				},
				"data-dsh-usage-dock": true,
				children: react_jsx_runtime.jsxs("div", {
					className: "u_dockFrame",
					children: [
						react_jsx_runtime.jsx("button", {
							type: "button",
							className: "u_dockGrip",
							"aria-label": translate("action.dockDrag"),
							title: translate("action.dockDrag"),
							onPointerDown: onDockGripDown,
							onPointerMove: onDockGripMove,
							onPointerUp: onDockGripUp,
							children: react_jsx_runtime.jsx(GripIcon, { size: 12 })
						}),
						...pinnedIds.flatMap((id, index) => {
							const content = widgetContent(id);
							return [
								react_jsx_runtime.jsx("button", {
									type: "button",
									className: "u_dockItem",
									"data-widget": id,
									onClick: () => {
										setPanelAnchor(null);
										openPanel(id);
									},
									children: content.compact()
								}, id),
								index < pinnedIds.length - 1 && react_jsx_runtime.jsx("div", { className: "u_dockDivider" }, `div-${id}`)
							];
						}),
						react_jsx_runtime.jsx("button", {
							type: "button",
							className: "u_dockRefresh",
							"aria-label": translate("action.refresh"),
							title: translate("action.refresh"),
							onClick: retry,
							children: react_jsx_runtime.jsx(primitives.IconRefreshOutline14, { size: 11 })
						}),
						react_jsx_runtime.jsx("button", {
							type: "button",
							ref: dockSettingsRef,
							className: "u_dockSettings",
							"aria-label": translate("panel.title"),
							title: translate("panel.title"),
							onClick: () => {
								// Second click closes the panel; otherwise anchor the
								// panel: the VERTICAL position follows the gear, but
								// the panel pops out to the RIGHT of the sidebar with
								// a small gap so it never covers sidebar content.
								if (open) {
									setOpen(false);
									return;
								}
								const gear = dockSettingsRef.current;
								if (gear !== null) {
									const rect = gear.getBoundingClientRect();
									const panelGap = 12;
									const sidebarRight = dockMetrics?.rightEdge ?? rect.right;
									let panelLeft = sidebarRight + panelGap;
									// Keep the panel on-screen on narrow windows.
									const viewport = window.innerWidth || 1440;
									panelLeft = Math.min(panelLeft, viewport - 420);
									panelLeft = Math.max(panelLeft, 8);
									setPanelAnchor({
										left: panelLeft,
										bottom: window.innerHeight - (rect.top + rect.height / 2)
									});
								}
								openPanel(null);
							},
							children: react_jsx_runtime.jsx(primitives.IconSettingsOutline14, { size: 12 })
						})
					]
				})
			});

			if (!open) {
				// Rail mode (sidebar collapsed): a single round balance button.
				// Clicking it reveals the full dock; a transparent scrim closes it
				// again on any outside click.
				if (!wide && !dockOpen) {
					return react_jsx_runtime.jsx("button", {
						type: "button",
						className: "u_railBtn",
						style: {
							...themeStyle,
							bottom: `${settings.dockOffset}px`,
							...(dockMetrics !== null && dockMetrics.centerX !== void 0 ? { left: `${dockMetrics.centerX}px` } : { left: "14px" })
						},
						"data-dsh-usage-rail": true,
						"aria-label": translate("panel.title"),
						onClick: () => setDockOpen(true),
						children: [
							react_jsx_runtime.jsx("span", { className: "u_railLabel", children: translate("widget.balance") }),
							react_jsx_runtime.jsx("span", { className: "u_railValue", "data-tone": balanceCompact.tone, children: balanceCompact.value })
						]
					});
				}
				if (!wide && dockOpen) {
					return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
						children: [
							react_jsx_runtime.jsx("div", { className: "u_railScrim", onClick: () => setDockOpen(false) }),
							dock
						]
					});
				}
				return dock;
			}

			const panel = react_jsx_runtime.jsxs("section", {
				className: "u_panel",
				style: {
					...themeStyle,
					...(panelAnchor !== null ? { left: `${panelAnchor.left}px`, bottom: `${panelAnchor.bottom}px` } : {})
				},
				"data-dsh-usage-panel": true,
				"aria-label": translate("panel.title"),
				children: [
					react_jsx_runtime.jsxs("header", {
						className: "u_header",
						children: [
							react_jsx_runtime.jsxs("div", {
								className: "u_headerLeft",
								children: [
									react_jsx_runtime.jsx(primitives.IconDataOutline16, { size: 16 }),
									react_jsx_runtime.jsx("span", { className: "u_title", children: translate("panel.title") })
								]
							}),
							react_jsx_runtime.jsxs("div", {
								className: "u_headerActions",
								children: [
									react_jsx_runtime.jsx(primitives.Tooltip, {
										label: translate("action.refresh"),
										side: "bottom",
										delayMs: 500,
										children: react_jsx_runtime.jsx("button", {
											type: "button",
											className: "u_iconButton",
											"aria-label": translate("action.refresh"),
											onClick: retry,
											children: react_jsx_runtime.jsx(primitives.IconRefreshOutline14, { size: 14 })
										})
									}),
									react_jsx_runtime.jsx(primitives.Tooltip, {
										label: translate("action.customize"),
										side: "bottom",
										delayMs: 500,
										children: react_jsx_runtime.jsx("button", {
											type: "button",
											className: "u_iconButton",
											"data-active": showCustomizer || void 0,
											"aria-label": translate("action.customize"),
											onClick: () => setShowCustomizer((value) => !value),
											children: react_jsx_runtime.jsx(primitives.IconSettingsOutline14, { size: 14 })
										})
									}),
									react_jsx_runtime.jsx(primitives.Tooltip, {
										label: translate("action.close"),
										side: "bottom",
										delayMs: 500,
										children: react_jsx_runtime.jsx("button", {
											type: "button",
											className: "u_iconButton",
											"aria-label": translate("action.close"),
											onClick: () => setOpen(false),
											children: react_jsx_runtime.jsx(primitives.IconCloseOutline16, { size: 14 })
										})
									})
								]
							})
						]
					}),
					react_jsx_runtime.jsxs("div", {
						className: "u_body",
						children: [
							showCustomizer && customizer,
							usageError !== null && react_jsx_runtime.jsxs("div", {
								className: "u_error",
								children: [
									react_jsx_runtime.jsx("span", { children: usageError }),
									react_jsx_runtime.jsx("button", { type: "button", className: "u_retry", onClick: retry, children: translate("action.retry") })
								]
							}),
						react_jsx_runtime.jsxs("div", {
							className: "u_grid",
							ref: gridRef,
							children: displayIds.map((id) => {
								if (id === GHOST_ID) {
									return react_jsx_runtime.jsx("div", {
										className: "u_widget u_ghost",
										"data-widget": GHOST_ID,
										"data-width": WIDGET_WIDTH[dragState?.id] ?? "half"
									}, GHOST_ID);
								}
								const state = settings.widgets[id];
								const content = widgetContent(id);
								return react_jsx_runtime.jsxs("div", {
									className: "u_widget",
									"data-widget": id,
									"data-width": WIDGET_WIDTH[id] ?? "half",
									"data-dragging": dragState !== null && dragState.id === id || void 0,
									draggable: true,
									onDragStart: onDragStart(id),
									onDragOver: onDragOver(id),
									onDragEnd: onDragEnd,
									children: [
										react_jsx_runtime.jsxs("div", {
											className: "u_widgetHead",
											children: [
												react_jsx_runtime.jsx("button", {
													type: "button",
													className: "u_widgetTitle",
													onClick: () => toggleWidgetKey(id, "collapsed"),
													children: translate(`widget.${id}`)
												}),
												react_jsx_runtime.jsx("span", {
													className: "u_wIconBtn u_wHoverBtn",
													"aria-hidden": true,
													title: translate("action.drag"),
													children: react_jsx_runtime.jsx(GripIcon, { size: 12 })
												}),
												WIDGET_PINABLE[id] !== false && react_jsx_runtime.jsx("button", {
													type: "button",
													className: "u_wIconBtn u_wHoverBtn",
													"data-pinned": state.pinned || void 0,
													"aria-label": state.pinned ? translate("action.unpin") : translate("action.pin"),
													title: state.pinned ? translate("action.unpin") : translate("action.pin"),
													onClick: () => toggleWidgetKey(id, "pinned"),
													children: react_jsx_runtime.jsx(PinIcon, { size: 12 })
												}),
												react_jsx_runtime.jsx("button", {
													type: "button",
													className: "u_wIconBtn u_wHoverBtn",
													"aria-label": translate("action.hide"),
													title: translate("action.hide"),
													onClick: () => toggleWidgetKey(id, "visible"),
													children: react_jsx_runtime.jsx(primitives.IconCloseOutline16, { size: 12 })
												})
											]
										}),
										!state.collapsed && react_jsx_runtime.jsx("div", {
											className: "u_wBody",
											children: content.detail()
										})
									]
								}, id);
							})
						}),
							hiddenIds.length > 0 && react_jsx_runtime.jsxs("div", {
								className: "u_hiddenBox",
								children: [
									react_jsx_runtime.jsx("button", {
										type: "button",
										className: "u_hiddenToggle",
										children: translate("hidden.count", { count: hiddenIds.length })
									}),
									hiddenIds.map((id) => react_jsx_runtime.jsxs("div", {
										className: "u_hiddenRow",
										children: [
											react_jsx_runtime.jsx("span", { className: "u_hiddenName", children: translate(`widget.${id}`) }),
											react_jsx_runtime.jsx("button", {
												type: "button",
												className: "u_restore",
												onClick: () => toggleWidgetKey(id, "visible"),
												children: translate("hidden.restore")
											})
										]
									}, id))
								]
							}),
							updatedLabel !== "" && react_jsx_runtime.jsx("p", { className: "u_footerNote", children: updatedLabel })
						]
					})
				]
			});

			return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, { children: [dock, panel] });
		}
		//#endregion

		//#region plugin body
		/** Services required by the client plugin body. */
		const inject = ["slots", "locale"];

		/**
		 * Client plugin body: register the dictionaries and the sidebar footer action.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "usage: dictionaries");
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "usage",
				locale: NS,
				order: 10
			}, UsagePanel));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		exports.UsagePanel = UsagePanel;
		exports.fmtTokens = fmtTokens;
		exports.fmtCompact = fmtCompact;
		exports.fmtCurrency = fmtCurrency;
		exports.fmtHit = fmtHit;
		exports.heatLevel = heatLevel;
		exports.heatColor = heatColor;
		exports.defaultSettings = defaultSettings;
		exports.normalizeSettings = normalizeSettings;
		exports.reorderWidget = reorderWidget;
		exports.createLoader = createLoader;
		return module.exports;
	}
});
