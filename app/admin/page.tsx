"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";

interface User {
  _id: string;
  username: string;
  role: "admin" | "user";
  created_at: string;
}

// ---------------------------------------------------------------------------
// Admin panel
// ---------------------------------------------------------------------------

export default function AdminPage() {
  const router = useRouter();

  const [me, setMe]             = useState<{ username: string; role: string } | null>(null);
  const [users, setUsers]       = useState<User[]>([]);
  const [activeModel, setActiveModel]   = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelSaved, setModelSaved]     = useState(false);

  // Create-user form
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole]         = useState<"user" | "admin">("user");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating]       = useState(false);

  // ---- Load data on mount ----
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => router.push("/login"));

    fetchUsers();
    fetchSettings();
    fetchAvailableModels();
  }, [router]);

  async function fetchUsers() {
    const res = await fetch("/api/admin/users");
    if (res.ok) setUsers(await res.json());
  }

  async function fetchSettings() {
    const res = await fetch("/api/admin/settings");
    if (res.ok) {
      const data = await res.json();
      setActiveModel(data.active_model ?? "");
    }
  }

  async function fetchAvailableModels() {
    try {
      const res = await fetch("/api/models");
      if (res.ok) {
        const data = await res.json();
        const ids: string[] = (data.models ?? []).map(
          (m: { id?: string; name?: string }) => m.id ?? m.name ?? ""
        ).filter(Boolean);
        setAvailableModels(ids);
      }
    } catch { /* non-critical */ }
  }

  // ---- Save model ----
  async function handleSaveModel() {
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active_model: activeModel }),
    });
    if (res.ok) {
      setModelSaved(true);
      setTimeout(() => setModelSaved(false), 2500);
    }
  }

  // ---- Create user ----
  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword, role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error ?? "Failed to create user"); return; }
      setNewUsername("");
      setNewPassword("");
      setNewRole("user");
      fetchUsers();
    } finally {
      setCreating(false);
    }
  }

  // ---- Delete user ----
  async function handleDelete(id: string, username: string) {
    if (!confirm(`Delete user "${username}"?`)) return;
    await fetch(`/api/admin/users?id=${id}`, { method: "DELETE" });
    fetchUsers();
  }

  // ---- Logout ----
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span className="font-semibold text-gray-900">QTI Reviewer — Admin</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="text-sm text-blue-600 hover:underline"
          >
            ← Reviewer
          </button>
          {me && (
            <span className="text-sm text-gray-500">
              Signed in as <strong>{me.username}</strong>
            </span>
          )}
          <button
            onClick={handleLogout}
            className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-10">

        {/* ---- Gemini Model ---- */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">AI Model</h2>
          <p className="text-sm text-gray-500 mb-5">
            This model is used for all users. Users cannot change it.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            {availableModels.length > 0 ? (
              <select
                value={activeModel}
                onChange={(e) => setActiveModel(e.target.value)}
                className="px-3.5 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[260px]"
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={activeModel}
                onChange={(e) => setActiveModel(e.target.value)}
                placeholder="e.g. gemini-2.5-flash"
                className="px-3.5 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[260px]"
              />
            )}

            <button
              onClick={handleSaveModel}
              disabled={!activeModel.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg
                         hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              Save
            </button>

            {modelSaved && (
              <span className="text-sm text-green-600 font-medium">✓ Saved</span>
            )}
          </div>
        </section>

        {/* ---- Create User ---- */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Create User</h2>
          <p className="text-sm text-gray-500 mb-5">Add a new reviewer account.</p>

          <form onSubmit={handleCreateUser} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Username</label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                required
                disabled={creating}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
                placeholder="username"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={creating}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
                placeholder="password"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as "user" | "admin")}
                disabled={creating}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={creating || !newUsername.trim() || !newPassword}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg
                         hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </form>

          {createError && (
            <p className="mt-3 text-sm text-red-600">{createError}</p>
          )}
        </section>

        {/* ---- User Table ---- */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-5">
            Users <span className="ml-2 text-sm font-normal text-gray-400">({users.length})</span>
          </h2>

          {users.length === 0 ? (
            <p className="text-sm text-gray-400">No users yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                    <th className="pb-3 pr-6">Username</th>
                    <th className="pb-3 pr-6">Role</th>
                    <th className="pb-3 pr-6">Created</th>
                    <th className="pb-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {users.map((u) => (
                    <tr key={u._id} className="hover:bg-gray-50">
                      <td className="py-3 pr-6 font-medium text-gray-800">{u.username}</td>
                      <td className="py-3 pr-6">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                          ${u.role === "admin"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-gray-100 text-gray-600"
                          }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="py-3 pr-6 text-gray-500">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 text-right">
                        {u._id !== me?.username && (
                          <button
                            onClick={() => handleDelete(u._id, u.username)}
                            className="text-red-500 hover:text-red-700 text-xs font-medium"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </main>
    </div>
  );
}
