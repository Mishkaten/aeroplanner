"use client";

import { useState } from "react";
import { Plane } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";

/** Sign-in for the shared testing workspace. One shared account, created by the project owner. */
export function LoginScreen() {
  const signIn = useWorkspace((s) => s.signIn);
  const signingIn = useWorkspace((s) => s.signingIn);
  const error = useWorkspace((s) => s.error);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <form
        className="card cardb"
        style={{ width: "min(420px, 100%)", display: "flex", flexDirection: "column", gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          void signIn(email, password);
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Plane size={28} aria-hidden="true" color="var(--acc)" />
          <div>
            <h1 style={{ margin: 0, fontSize: 20 }}>AeroPlanner</h1>
            <span className="hint">Test workspace. Sign in to continue.</span>
          </div>
        </div>
        <div className="fld">
          <label htmlFor="li-email">Email</label>
          <input id="li-email" className="inp" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="fld">
          <label htmlFor="li-pw">Password</label>
          <input id="li-pw" className="inp" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && (
          <div className="err-t" role="alert">
            {error}
          </div>
        )}
        <button className="btn pri" style={{ height: 38 }} type="submit" disabled={signingIn}>
          {signingIn ? "Signing in..." : "Sign in"}
        </button>
        <p className="hint" style={{ margin: 0 }}>
          This workspace is shared by everyone who has the login. Do not enter data you are not allowed to share with them.
        </p>
      </form>
    </main>
  );
}
