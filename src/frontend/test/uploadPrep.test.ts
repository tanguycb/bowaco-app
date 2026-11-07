// 2d.3: beslislogica van de uploadhelper (soort → actie, 15 MB-grens, video). Draaien: cd src/frontend && npx vitest run test
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, VIDEO_MSG, checkSize, clampSide, planUpload, sideFor } from "../src/lib/uploadPrep";

const on = { shrink: true, maxSide: 2000 };
const f = (name: string, type: string, size = 1000) => ({ name, type, size });

describe("planUpload", () => {
  it("foto's worden altijd hercodeerd", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/heic"]) expect(planUpload(f("a", t), on).action).toBe("photo");
    expect(planUpload(f("IMG_1.HEIC", ""), on).action).toBe("photo");
    expect(planUpload(f("a.jpg", "image/jpeg", 40e6), on).action).toBe("photo"); // grens pas na verkleining
    expect(planUpload(f("a.jpg", "image/jpeg"), { shrink: false, maxSide: 2000 }).action).toBe("photo");
  });
  it("documenten ongewijzigd", () => {
    for (const t of ["application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/msword", "image/svg+xml", "image/gif"]) expect(planUpload(f("d", t), on).action).toBe("keep");
  });
  it("video geweigerd", () => {
    expect(planUpload(f("v.mp4", "video/mp4"), on)).toEqual({ action: "reject", message: VIDEO_MSG });
    expect(planUpload(f("v.MOV", ""), on).action).toBe("reject");
  });
  it("grens 15 MB voor documenten", () => {
    expect(planUpload(f("d.pdf", "application/pdf", MAX_UPLOAD_BYTES), on).action).toBe("keep");
    const r = planUpload(f("d.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1), on);
    expect(r.action).toBe("reject");
    if (r.action === "reject") expect(r.message).toContain("15 MB");
  });
  it("grens na verkleining en maat", () => {
    expect(checkSize("a.jpg", MAX_UPLOAD_BYTES)).toBeNull();
    expect(checkSize("a.jpg", MAX_UPLOAD_BYTES + 1)).toContain("15 MB");
    expect(sideFor(on)).toBe(2000);
    expect(sideFor({ shrink: false, maxSide: 2000 })).toBe(Infinity);
    expect(clampSide(50)).toBe(400);
    expect(clampSide(NaN)).toBe(2000);
  });
});
