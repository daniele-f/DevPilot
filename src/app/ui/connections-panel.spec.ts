import { afterEach, describe, expect, it } from "vitest";
import { TestBed } from "@angular/core/testing";
import { provideZonelessChangeDetection } from "@angular/core";
import { InteractivityChecker } from "@angular/cdk/a11y";
import { ConnectionsPanel } from "./connections-panel";
import {
  AI_CONNECTIONS,
  ConnectionsClient,
  CreatedConnection,
} from "../core/connections";
afterEach(() => TestBed.resetTestingModule());
describe("project connection setup", () => {
  it("offers OAuth URL setup without issuing credentials and can revoke grants", async () => {
    const connection: CreatedConnection = {
      id: "c1",
      project_id: "p1",
      name: "Codex",
      permission: "edit",
      created_at: "",
      last_used_at: null,
      revoked_at: null,
      configuration: "private configuration",
    };
    let created = true;
    const client: ConnectionsClient = {
      serverUrl: async () => "http://127.0.0.1:4202/mcp",
      list: async () => (created ? [connection] : []),
      create: async () => {
        created = true;
        return connection;
      },
      revoke: async () => {
        created = false;
      },
    };
    await TestBed.configureTestingModule({
      imports: [ConnectionsPanel],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AI_CONNECTIONS, useValue: client },
        {
          provide: InteractivityChecker,
          useValue: { isFocusable: () => true, isTabbable: () => true },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ConnectionsPanel);
    fixture.componentRef.setInput("project", {
      id: "p1",
      name: "DevPilot",
      owner_id: "u1",
      created_at: "",
    });
    fixture.detectChanges();
    await fixture.componentInstance.load();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector("#codex-server-url").value,
    ).toBe("http://127.0.0.1:4202/mcp");
    expect(fixture.nativeElement.textContent).toContain("Authenticate");
    expect(fixture.nativeElement.textContent).not.toContain("config.toml");
    expect(fixture.nativeElement.textContent).not.toContain("Create connection");
    expect(fixture.nativeElement.textContent).toContain("Not used yet");
    await fixture.componentInstance.revoke("c1");
    await fixture.whenStable();
    expect(fixture.componentInstance.connections()).toEqual([]);
  });
});
