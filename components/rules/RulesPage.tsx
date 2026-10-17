"use client";

import { useMemo, useState } from "react";
import { COUNTRY_NAMES, pairLabel } from "@/lib/airports";
import { derive } from "@/lib/derived";
import { validateRule, type RuleForm } from "@/lib/forms";
import { requiredPermits } from "@/lib/permits";
import { useDemo } from "@/lib/store";
import { ListGate } from "@/components/common/ListGate";

const blank = (): RuleForm => ({ a: "", b: "", both: true, countryCode: "", type: "landing" });

/** Which permits each route needs. The planner enters them: the schedule checks legs against these rules (R4). */
export function RulesPage() {
  const data = useDemo((s) => s.data);
  const d = derive(data);
  const [form, setForm] = useState<RuleForm>(blank);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<RuleForm>) => setForm((f) => ({ ...f, ...p }));

  // routes flown in the schedule that no rule covers yet
  const uncovered = useMemo(() => {
    const seen = new Map<string, [string, string]>();
    for (const l of data.legs) {
      if (l.depIcao === "XXXX" || l.arrIcao === "XXXX") continue;
      if (requiredPermits(l.depIcao, l.arrIcao, data.permitRules).length === 0) {
        const key = [l.depIcao, l.arrIcao].sort().join("-");
        if (!seen.has(key)) seen.set(key, [l.depIcao, l.arrIcao]);
      }
    }
    return [...seen.values()].slice(0, 40);
  }, [data.legs, data.permitRules]);

  const add = () => {
    const r = validateRule(form, data.airports, data.permitRules);
    if (!r.value) {
      setError(r.error);
      return;
    }
    setError(null);
    useDemo.getState().commit([{ op: "insert", coll: "permitRules", value: r.value as never }], `Permit rule added: ${COUNTRY_NAMES[r.value.countryCode]} ${r.value.type}`);
    set({ countryCode: "" });
  };

  const grouped = new Map<string, typeof data.permitRules>();
  for (const r of data.permitRules) {
    const k = `${r.aIcao}>${r.bIcao}`;
    grouped.set(k, [...(grouped.get(k) ?? []), r]);
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Permit rules</h1>
          <p>Which countries each route needs a landing or overflight permit for. The Conflicts centre warns when a leg has no record or the permit is not obtained.</p>
        </div>
      </div>

      <section className="card cardb" aria-labelledby="add-rule" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h3 id="add-rule" style={{ margin: 0 }}>
          Add a rule
        </h3>
        <div className="fbar">
          <label>
            From{" "}
            <input className="inp mono" style={{ width: 130 }} list="rule-ap" value={form.a} placeholder="UGTB/TBS" onChange={(e) => set({ a: e.target.value.toUpperCase() })} />
          </label>
          <label>
            To{" "}
            <input className="inp mono" style={{ width: 130 }} list="rule-ap" value={form.b} placeholder="LYBE/BEG" onChange={(e) => set({ b: e.target.value.toUpperCase() })} />
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={form.both} onChange={(e) => set({ both: e.target.checked })} /> Both directions
          </label>
          <label>
            Country{" "}
            <input className="inp mono" style={{ width: 70 }} maxLength={2} placeholder="RS" value={form.countryCode} onChange={(e) => set({ countryCode: e.target.value.toUpperCase() })} />
          </label>
          <select className="sel" aria-label="Permit type" value={form.type} onChange={(e) => set({ type: e.target.value as RuleForm["type"] })}>
            <option value="landing">Landing</option>
            <option value="overflight">Overflight</option>
          </select>
          <button className="btn pri" onClick={add}>
            Add rule
          </button>
        </div>
        <datalist id="rule-ap">
          {data.airports
            .filter((a) => !a.provisional)
            .map((a) => (
              <option key={a.id} value={`${a.icao}/${a.iata}`} />
            ))}
        </datalist>
        {error && (
          <div className="err-t" role="alert">
            {error}
          </div>
        )}
        <span className="hint">Add one row per country. For a route that crosses two countries, add two rules.</span>
      </section>

      {uncovered.length > 0 && (
        <section className="card" aria-labelledby="unc">
          <div className="cardh">
            <h3 id="unc">Routes in the schedule with no permit rule</h3>
            <span className="b b-nt">{uncovered.length}</span>
          </div>
          <div className="cardb" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {uncovered.map(([a, b]) => (
              <button key={`${a}-${b}`} className="btn sm" onClick={() => set({ a: pairLabel(a, d.idx), b: pairLabel(b, d.idx), both: true })}>
                {pairLabel(a, d.idx)} to {pairLabel(b, d.idx)}
              </button>
            ))}
          </div>
        </section>
      )}

      <ListGate>
        <section className="card scroll" aria-label="Permit rules">
          {data.permitRules.length === 0 ? (
            <div className="empty">
              <b>No permit rules yet</b>
              <span>Until you add rules, no leg is checked for permits.</span>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  {["Route", "Direction", "Country", "Permit"].map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                  <th scope="col">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...grouped.entries()].flatMap(([k, rs]) =>
                  rs.map((r, i) => (
                    <tr key={r.id}>
                      <td className="mono">
                        {i === 0 ? `${pairLabel(r.aIcao, d.idx)} to ${pairLabel(r.bIcao, d.idx)}` : ""}
                        <span className="sr-only">{k}</span>
                      </td>
                      <td>{r.both ? "Both ways" : "One way"}</td>
                      <td>{COUNTRY_NAMES[r.countryCode]}</td>
                      <td style={{ textTransform: "capitalize" }}>{r.type}</td>
                      <td>
                        <button className="btn sm" aria-label={`Remove ${COUNTRY_NAMES[r.countryCode]} ${r.type} rule for ${r.aIcao} to ${r.bIcao}`} onClick={() => useDemo.getState().commit([{ op: "remove", coll: "permitRules", id: r.id }], "Permit rule removed")}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          )}
        </section>
      </ListGate>
    </>
  );
}
