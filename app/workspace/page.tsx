"use client";

import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { WORKSPACE_MODE } from "@/lib/mode";

export default function Page() {
  if (!WORKSPACE_MODE) {
    return (
      <div className="card empty">
        <b>Workspace is only available on the testing site</b>
        <span>This build is the browser-only demo.</span>
      </div>
    );
  }
  return <WorkspacePage />;
}
