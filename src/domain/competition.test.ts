import { describe, expect, it } from "vitest";
import { validateCompetition, sortLobby, type CompetitionInput, type CompetitionCard } from "./competition";

function baseInput(overrides: Partial<CompetitionInput> = {}): CompetitionInput {
  return {
    name: "黑客松",
    organizer: "",
    theme: "",
    eligibility: "",
    teamSize: "",
    prize: "",
    url: "https://example.com",
    signupDeadline: new Date("2026-10-01T15:59:59.999Z"),
    submissionDeadline: null,
    finalDate: null,
    ...overrides,
  };
}

describe("validateCompetition", () => {
  it("名稱空白 → 請填比賽名稱", () => {
    const result = validateCompetition(baseInput({ name: "  " }));
    expect(result).toEqual({ ok: false, errors: { name: "請填比賽名稱" } });
  });

  it("網址不是 http/https → 請填正確的官方連結", () => {
    const result = validateCompetition(baseInput({ url: "javascript:alert(1)" }));
    expect(result).toEqual({ ok: false, errors: { url: "請填正確的官方連結" } });
  });

  it("網址亂填不是合法 URL → 請填正確的官方連結", () => {
    const result = validateCompetition(baseInput({ url: "not a url" }));
    expect(result).toEqual({ ok: false, errors: { url: "請填正確的官方連結" } });
  });

  it("報名截止日缺 → 請填報名截止日", () => {
    const result = validateCompetition(baseInput({ signupDeadline: null }));
    expect(result).toEqual({ ok: false, errors: { signupDeadline: "請填報名截止日" } });
  });

  it("繳件日早於報名截止 → 繳件截止日不能早於報名截止日", () => {
    const result = validateCompetition(
      baseInput({
        signupDeadline: new Date("2026-10-10T15:59:59.999Z"),
        submissionDeadline: new Date("2026-10-01T15:59:59.999Z"),
      })
    );
    expect(result).toEqual({ ok: false, errors: { submissionDeadline: "繳件截止日不能早於報名截止日" } });
  });

  it("決賽日期早於繳件截止 → 決賽日期不能早於繳件截止日", () => {
    const result = validateCompetition(
      baseInput({
        signupDeadline: new Date("2026-10-01T15:59:59.999Z"),
        submissionDeadline: new Date("2026-10-10T15:59:59.999Z"),
        finalDate: new Date("2026-10-05T15:59:59.999Z"),
      })
    );
    expect(result).toEqual({ ok: false, errors: { finalDate: "決賽日期不能早於繳件截止日" } });
  });

  // Final review minor 12：繳件日沒填時，決賽日期還是不能早於報名截止日。
  it("繳件日沒填、決賽日期早於報名截止 → 決賽日期不能早於報名截止日", () => {
    const result = validateCompetition(
      baseInput({
        signupDeadline: new Date("2026-10-10T15:59:59.999Z"),
        submissionDeadline: null,
        finalDate: new Date("2026-10-05T15:59:59.999Z"),
      })
    );
    expect(result).toEqual({ ok: false, errors: { finalDate: "決賽日期不能早於報名截止日" } });
  });

  it("繳件日沒填、決賽日期晚於報名截止 → ok", () => {
    const result = validateCompetition(
      baseInput({ signupDeadline: new Date("2026-10-10T15:59:59.999Z"), finalDate: new Date("2026-10-20T15:59:59.999Z") })
    );
    expect(result).toEqual({ ok: true });
  });

  it("全部合法 → ok", () => {
    const result = validateCompetition(baseInput());
    expect(result).toEqual({ ok: true });
  });

  it("只填必填欄位（其餘留空）也算合法", () => {
    const result = validateCompetition(baseInput({ organizer: "", theme: "", eligibility: "", teamSize: "", prize: "" }));
    expect(result).toEqual({ ok: true });
  });

  // Minor 1（controller ruling，fix round 1）：報名截止日缺的時候，沒辦法拿它跟繳件截止日比較
  // 早晚——只該報「請填報名截止日」這一個錯誤，不該連帶在 submissionDeadline 上也生出一個
  // 「早於報名截止」之類的錯誤（signupDeadline 是 null，根本沒有東西可以比較）。
  it("報名截止日缺、但繳件截止日有填 → 只報報名截止日缺，不會連帶報繳件截止日的錯", () => {
    const result = validateCompetition(
      baseInput({ signupDeadline: null, submissionDeadline: new Date("2026-10-10T15:59:59.999Z") })
    );
    expect(result).toEqual({ ok: false, errors: { signupDeadline: "請填報名截止日" } });
  });
});

function card(overrides: Partial<CompetitionCard> = {}): CompetitionCard {
  return {
    id: "c1",
    name: "比賽",
    organizer: null,
    theme: null,
    eligibility: null,
    teamSize: null,
    prize: null,
    url: "https://example.com",
    signupDeadline: new Date("2026-10-01T15:59:59.999Z"),
    submissionDeadline: null,
    finalDate: null,
    status: "published",
    ...overrides,
  };
}

describe("sortLobby", () => {
  it("報名截止日由近到遠排在 open", () => {
    const now = new Date("2026-09-01T00:00:00Z");
    const a = card({ id: "a", signupDeadline: new Date("2026-10-10T15:59:59.999Z") });
    const b = card({ id: "b", signupDeadline: new Date("2026-10-05T15:59:59.999Z") });
    const result = sortLobby([a, b], now);
    expect(result.open.map((c) => c.id)).toEqual(["b", "a"]);
    expect(result.closed).toEqual([]);
  });

  it("已過報名截止的移到 closed，最近截止的在前", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    const a = card({ id: "a", signupDeadline: new Date("2026-10-01T15:59:59.999Z") });
    const b = card({ id: "b", signupDeadline: new Date("2026-10-10T15:59:59.999Z") });
    const result = sortLobby([a, b], now);
    expect(result.open).toEqual([]);
    expect(result.closed.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("台北時區邊界：截止時刻當下仍算 open，過了那一刻才算 closed", () => {
    const deadline = new Date("2026-10-01T15:59:59.999Z"); // 台北時間 2026-10-01 23:59:59.999
    const c = card({ id: "a", signupDeadline: deadline });
    expect(sortLobby([c], deadline).open.map((x) => x.id)).toEqual(["a"]);
    expect(sortLobby([c], new Date(deadline.getTime() + 1)).closed.map((x) => x.id)).toEqual(["a"]);
  });
});
