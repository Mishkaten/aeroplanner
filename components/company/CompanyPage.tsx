"use client";

import { useRef, useState } from "react";
import { derive } from "@/lib/derived";
import { companyToForm, logoProblem, validateCompany, type CompanyForm } from "@/lib/forms";
import { useDemo } from "@/lib/store";

/** Reads a PNG or SVG file and returns a PNG data URL (SVG is rasterised so Word and PDF can embed it). */
async function toPngDataUrl(file: File): Promise<string> {
  const text = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(file);
  });
  if (file.type === "image/png") return text;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("decode"));
    img.src = text;
  });
  const w = img.naturalWidth || 256;
  const h = img.naturalHeight || 256;
  const scale = Math.min(1, 256 / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export function CompanyPage() {
  const company = useDemo((s) => s.data.company);
  const idx = derive(useDemo.getState().data).idx;
  const [form, setForm] = useState<CompanyForm>(() => companyToForm(company, idx));
  const [logo, setLogo] = useState<string | null>(company.logoDataUrl);
  const [logoMsg, setLogoMsg] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const result = validateCompany(form, company, idx);
  const set = (p: Partial<CompanyForm>) => setForm((f) => ({ ...f, ...p }));
  const err = (k: keyof CompanyForm) => (show ? result.errors[k] : undefined);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const problem = logoProblem(file);
    if (problem) {
      setLogoMsg(problem);
      return;
    }
    try {
      setLogo(await toPngDataUrl(file));
      setLogoMsg(null);
    } catch {
      setLogoMsg("Could not read this image. Try another PNG or SVG file.");
    }
  };

  const save = () => {
    setShow(true);
    if (!result.value) return;
    useDemo.getState().saveCompany({ ...result.value, logoDataUrl: logo });
  };

  const text = (id: keyof CompanyForm, label: string, mono = true, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="fld">
      <label htmlFor={`c-${id}`}>{label}</label>
      <input id={`c-${id}`} className={`inp ${mono ? "mono" : ""}`} value={form[id]} aria-invalid={!!err(id)} aria-describedby={err(id) ? `c-${id}-e` : undefined} onChange={(e) => set({ [id]: e.target.value } as Partial<CompanyForm>)} {...extra} />
      <span id={`c-${id}-e`} className="err-t">
        {err(id)}
      </span>
    </div>
  );

  return (
    <>
      <div className="head">
        <div>
          <h1>Company profile</h1>
          <p>Printed on every checklist.</p>
        </div>
      </div>
      <section className="card cardb" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="fgrid">
          {text("legalName", "Legal name", false)}
          {text("vatNumber", "VAT number")}
          {text("icao", "ICAO designator", true, { maxLength: 3 })}
          {text("iata", "IATA designator", true, { maxLength: 2 })}
          {text("aocNumber", "AOC number")}
          {text("base", "Base", true, { placeholder: "UGTB/TBS" })}
          {text("address", "Address", false)}
          {text("opsContact", "Operations contact", false)}
          {text("minGround", "Minimum ground time (minutes)", true, { inputMode: "numeric" })}
        </div>
        <div className="fld">
          <label htmlFor="c-dt">What does &quot;DAY n LT&quot; mean in your Excel lines?</label>
          <select id="c-dt" className="sel" value={form.dayTagMode} onChange={(e) => set({ dayTagMode: e.target.value as CompanyForm["dayTagMode"] })}>
            <option value="ignore">Do not check it</option>
            <option value="arrival_local">Weekday of the local arrival date (ISO, Monday is 1)</option>
            <option value="departure_day">Weekday of the departure date (the row date)</option>
          </select>
          <span className="hint">Used by the Excel import to flag a DAY tag that does not match the dates.</span>
        </div>
        <div className="fld">
          <label htmlFor="c-h">Default checklist header text</label>
          <textarea id="c-h" className="inp" value={form.checklistHeaderText} onChange={(e) => set({ checklistHeaderText: e.target.value })} />
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="Company logo" style={{ width: 64, height: 64, objectFit: "contain", border: "1px solid var(--line)", borderRadius: 4, background: "#fff" }} />
          ) : (
            <div style={{ width: 64, height: 64, border: "1px dashed var(--mut)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--mut)", fontSize: 12 }}>LOGO</div>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/svg+xml,.png,.svg" hidden onChange={(e) => onFile(e.target.files?.[0])} aria-label="Logo file" />
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Upload logo
          </button>
          {logo && (
            <button className="btn" onClick={() => setLogo(null)}>
              Remove logo
            </button>
          )}
          <span className="hint">PNG or SVG, 500 KB or smaller, shown on checklists</span>
        </div>
        {logoMsg && (
          <div className="err-t" role="alert">
            {logoMsg}
          </div>
        )}
        <div>
          <button className="btn pri" onClick={save}>
            Save profile
          </button>
        </div>
        {show && !result.value && (
          <div className="err-t" role="alert">
            Fix the highlighted fields to save.
          </div>
        )}
      </section>
    </>
  );
}
