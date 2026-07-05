import { describe, expect, it } from "vitest";
import {
	clampThinkingLevel,
	effortToThinkingLevel,
	getSupportedThinkingLevels,
	thinkingLevelToEffort,
} from "../src/models.ts";
import type { Api, Model } from "../src/types.ts";

// Minimal model fixture: only id/reasoning/thinkingLevelMap affect thinking
// level math. The rest is filled to satisfy the Model type.
function makeModel(opts: {
	id: string;
	reasoning: boolean;
	thinkingLevelMap?: Record<string, string | null>;
}): Model<Api> {
	return {
		id: opts.id,
		name: opts.id,
		api: "anthropic-messages" as Api,
		provider: "test",
		baseUrl: "https://example.test",
		reasoning: opts.reasoning,
		thinkingLevelMap: opts.thinkingLevelMap,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 8_192,
	};
}

// 6-level model: off, minimal, low, medium, high, xhigh
const modelWithXhigh = makeModel({ id: "wide", reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } });
// 5-level model: off, minimal, low, medium, high (no xhigh)
const modelWithoutXhigh = makeModel({ id: "narrow", reasoning: true });
// Non-reasoning model: only off
const modelNoReasoning = makeModel({ id: "dumb", reasoning: false });

describe("getSupportedThinkingLevels", () => {
	it("returns the full 6-level ladder for a reasoning model with xhigh", () => {
		expect(getSupportedThinkingLevels(modelWithXhigh)).toEqual(["off", "minimal", "low", "medium", "high", "xhigh"]);
	});

	it("drops xhigh when the map does not declare it", () => {
		expect(getSupportedThinkingLevels(modelWithoutXhigh)).toEqual(["off", "minimal", "low", "medium", "high"]);
	});

	it("returns only off for a non-reasoning model", () => {
		expect(getSupportedThinkingLevels(modelNoReasoning)).toEqual(["off"]);
	});
});

describe("thinkingLevelToEffort", () => {
	it("maps the lowest tier to 0 and the highest to 1", () => {
		expect(thinkingLevelToEffort(modelWithXhigh, "off")).toBe(0);
		expect(thinkingLevelToEffort(modelWithXhigh, "xhigh")).toBe(1);
		expect(thinkingLevelToEffort(modelWithoutXhigh, "off")).toBe(0);
		expect(thinkingLevelToEffort(modelWithoutXhigh, "high")).toBe(1);
	});

	it("is proportional to position on the model's own ladder", () => {
		// 6 levels: indices 0..5 -> effort 0, 0.2, 0.4, 0.6, 0.8, 1
		expect(thinkingLevelToEffort(modelWithXhigh, "medium")).toBe(0.6);
		// 5 levels: indices 0..4 -> effort 0, 0.25, 0.5, 0.75, 1 (medium = index 3)
		expect(thinkingLevelToEffort(modelWithoutXhigh, "medium")).toBe(0.75);
	});

	it("returns 0 for an unknown level", () => {
		expect(thinkingLevelToEffort(modelWithoutXhigh, "xhigh")).toBe(0);
	});

	it("returns 0 for a non-reasoning model", () => {
		expect(thinkingLevelToEffort(modelNoReasoning, "off")).toBe(0);
	});
});

describe("effortToThinkingLevel", () => {
	it("maps 0 to off and 1 to the model's top tier", () => {
		expect(effortToThinkingLevel(modelWithXhigh, 0)).toBe("off");
		expect(effortToThinkingLevel(modelWithXhigh, 1)).toBe("xhigh");
		expect(effortToThinkingLevel(modelWithoutXhigh, 0)).toBe("off");
		expect(effortToThinkingLevel(modelWithoutXhigh, 1)).toBe("high");
	});

	it("clamps effort outside [0, 1]", () => {
		expect(effortToThinkingLevel(modelWithXhigh, -0.5)).toBe("off");
		expect(effortToThinkingLevel(modelWithXhigh, 2)).toBe("xhigh");
	});

	it("rounds to the nearest supported tier", () => {
		// 6 levels (step 0.2): 0.5 -> round(0.5*5)=round(2.5)=3 -> medium
		expect(effortToThinkingLevel(modelWithXhigh, 0.5)).toBe("medium");
		// 5 levels (step 0.25): 0.5 -> round(0.5*4)=round(2)=2 -> low
		expect(effortToThinkingLevel(modelWithoutXhigh, 0.5)).toBe("low");
	});
});

describe("effort round-trips across model switches", () => {
	it("preserves max-effort intent when switching wide -> narrow -> wide", () => {
		// Start at xhigh on the 6-level model.
		const effort = thinkingLevelToEffort(modelWithXhigh, "xhigh");
		expect(effort).toBe(1);

		// Project onto the 5-level model: top tier (high).
		const narrowLevel = effortToThinkingLevel(modelWithoutXhigh, effort);
		expect(narrowLevel).toBe("high");

		// Switch back: re-project the narrow model's high onto the wide model.
		const effortOnNarrow = thinkingLevelToEffort(modelWithoutXhigh, narrowLevel);
		const wideLevel = effortToThinkingLevel(modelWithXhigh, effortOnNarrow);
		expect(wideLevel).toBe("xhigh");
	});

	it("preserves mid-effort intent when switching wide -> narrow -> wide", () => {
		const effort = thinkingLevelToEffort(modelWithXhigh, "medium"); // 0.6
		// 5 levels: round(0.6*4)=round(2.4)=2 -> low
		const narrowLevel = effortToThinkingLevel(modelWithoutXhigh, effort);
		expect(narrowLevel).toBe("low");

		// low on the 5-level model is effort 0.5; back on the 6-level model
		// round(0.5*5)=round(2.5)=3 -> medium. Mid-effort intent is preserved.
		const effortOnNarrow = thinkingLevelToEffort(modelWithoutXhigh, narrowLevel); // 0.5
		const wideLevel = effortToThinkingLevel(modelWithXhigh, effortOnNarrow);
		expect(wideLevel).toBe("medium");
	});

	it("clamps a level unsupported on the target down to the nearest valid one (name clamp)", () => {
		// xhigh is not valid on the narrow model; clamp must drop to high, not off.
		expect(clampThinkingLevel(modelWithoutXhigh, "xhigh")).toBe("high");
	});
});
