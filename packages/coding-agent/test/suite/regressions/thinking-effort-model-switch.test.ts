import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.ts";

// Reproduces the thinking-level loss when switching between models whose
// supported ladders have different lengths.
//
// wide  : off, minimal, low, medium, high, xhigh  (6 levels)
// narrow: off, minimal, low, medium, high         (5 levels, no xhigh)
//
// Pre-fix behaviour: setModel clamped by name only. xhigh on `wide` clamped
// down to high on `narrow` (correct), but switching back to `wide` kept high
// (still a valid level there), silently losing the user's max-effort intent.
// The fix re-projects by normalised effort (1.0 = top of each ladder), so the
// round-trip restores xhigh.

describe("thinking level survives model switch across ladder widths", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("restores xhigh after wide -> narrow -> wide", async () => {
		const harness = await createHarness({
			models: [
				{ id: "wide", name: "Wide", reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } },
				{ id: "narrow", name: "Narrow", reasoning: true },
			],
		});
		harnesses.push(harness);

		const wide = harness.getModel("wide")!;
		const narrow = harness.getModel("narrow")!;

		// wide is the initial model. Pin the session to xhigh.
		harness.session.setThinkingLevel("xhigh");
		expect(harness.session.thinkingLevel).toBe("xhigh");

		// Switch to the 5-level model: xhigh is unsupported, so the effort (1.0)
		// projects onto narrow's top tier (high).
		await harness.session.setModel(narrow);
		expect(harness.session.thinkingLevel).toBe("high");

		// Switch back to the 6-level model. The effort is still 1.0, which
		// projects back onto wide's top tier (xhigh). Pre-fix this stayed "high".
		await harness.session.setModel(wide);
		expect(harness.session.thinkingLevel).toBe("xhigh");
	});

	it("keeps a mid-tier level stable across wide -> narrow -> wide", async () => {
		const harness = await createHarness({
			models: [
				{ id: "wide", name: "Wide", reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } },
				{ id: "narrow", name: "Narrow", reasoning: true },
			],
		});
		harnesses.push(harness);

		const wide = harness.getModel("wide")!;
		const narrow = harness.getModel("narrow")!;

		// medium on the 6-level model is effort 0.6.
		harness.session.setThinkingLevel("medium");
		expect(harness.session.thinkingLevel).toBe("medium");

		await harness.session.setModel(narrow);
		// 0.6 on a 5-level ladder rounds to index 2 -> low.
		expect(harness.session.thinkingLevel).toBe("low");

		await harness.session.setModel(wide);
		// low on the 5-level model is effort 0.5; round(0.5*5)=3 -> medium on wide.
		expect(harness.session.thinkingLevel).toBe("medium");
	});
});
