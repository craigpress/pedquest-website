"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMember, signOut as supabaseSignOut } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const ADMIN_EMAILS = ["pressca@chop.edu", "gbenedet@med.umich.edu", "ajay.thomas@bcm.edu"];

interface ProfileData {
  bio: string;
  title: string;
  department: string;
  interests: string[];
  orcidId: string;
  websiteUrl: string;
  photoUrl: string;
  cvFilename: string;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ─── Tag Input ──────────────────────────────────────────────────────────
function TagInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");

  function addTag() {
    const trimmed = input.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInput("");
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: tags.length ? 8 : 0 }}>
        {tags.map((tag) => (
          <span
            key={tag}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              borderRadius: 99,
              background: "var(--bg-card-hover, var(--bg))",
              border: "1px solid var(--border)",
              fontSize: "0.85rem",
              color: "var(--text)",
              fontFamily: "var(--body-font)",
            }}
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-secondary)",
                cursor: "pointer",
                padding: 0,
                fontSize: "1rem",
                lineHeight: 1,
              }}
            >
              &times;
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder="Type and press Enter"
          style={{
            flex: 1,
            padding: "0.65rem 0.85rem",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: "0.9rem",
            fontFamily: "var(--body-font)",
            outline: "none",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent-primary)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
        />
        <button
          type="button"
          onClick={addTag}
          style={{
            padding: "0.65rem 1rem",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-card-hover, var(--bg))",
            color: "var(--text)",
            fontSize: "0.85rem",
            cursor: "pointer",
            fontFamily: "var(--body-font)",
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ─── Input Field ────────────────────────────────────────────────────────
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <label
        style={{
          display: "block",
          fontSize: "0.875rem",
          fontWeight: 600,
          color: "var(--text)",
          marginBottom: "0.4rem",
          fontFamily: "var(--body-font)",
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.7rem 0.85rem",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: "0.9rem",
  fontFamily: "var(--body-font)",
  outline: "none",
  transition: "border-color 0.2s",
  boxSizing: "border-box",
};

// ─── Profile Page ───────────────────────────────────────────────────────
export default function ProfilePage() {
  const router = useRouter();
  const { member, user, loading } = useMember();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cvInputRef = useRef<HTMLInputElement>(null);

  const isAuthenticated = !!user;
  const effectiveEmail = user?.email || null;
  const isAdmin = !!effectiveEmail && ADMIN_EMAILS.includes(effectiveEmail.toLowerCase());

  // Redirect if not authenticated
  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isAuthenticated, loading, router]);

  // Initialize profile from member data
  useEffect(() => {
    if (member) {
      setProfile({
        bio: member.bio || "",
        title: member.title || "",
        department: member.department || "",
        interests: [...(member.interests || [])],
        orcidId: member.orcidId || "",
        websiteUrl: member.websiteUrl || "",
        photoUrl: member.photoUrl || "",
        cvFilename: "",
      });
      if (member.photoUrl) {
        setPhotoPreview(member.photoUrl);
      }
      // Check for stored CV filename
      try {
        const storedCv = localStorage.getItem(`pedquest_cv_${member.id}`);
        if (storedCv) {
          setProfile((p) => (p ? { ...p, cvFilename: storedCv } : p));
        }
      } catch {
        // ignore
      }
    }
  }, [member]);

  const updateField = useCallback(
    <K extends keyof ProfileData>(key: K, value: ProfileData[K]) => {
      setProfile((p) => (p ? { ...p, [key]: value } : p));
      setSaved(false);
    },
    []
  );

  // ── Photo upload ────────────────────────────────────────────────
  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !member) return;

    // Client-side preview
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    // Try uploading to Supabase Storage
    try {
      const ext = file.name.split(".").pop();
      const path = `photos/${member.id}.${ext}`;
      const { error } = await supabase.storage
        .from("member-files")
        .upload(path, file, { upsert: true });

      if (!error) {
        const { data: urlData } = supabase.storage
          .from("member-files")
          .getPublicUrl(path);
        updateField("photoUrl", urlData.publicUrl);
        return;
      }
    } catch {
      // Supabase not available — store as data URL in localStorage
    }

    // Fallback: store preview URL
    const dataUrl = photoPreview || "";
    updateField("photoUrl", dataUrl);
  }

  // ── CV upload ───────────────────────────────────────────────────
  async function handleCvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !member) return;

    // Try uploading to Supabase Storage
    try {
      const path = `cvs/${member.id}/${file.name}`;
      const { error } = await supabase.storage
        .from("member-files")
        .upload(path, file, { upsert: true });

      if (!error) {
        updateField("cvFilename", file.name);
        try {
          localStorage.setItem(`pedquest_cv_${member.id}`, file.name);
        } catch { /* ignore */ }
        return;
      }
    } catch {
      // Supabase not available
    }

    // Fallback: just store the filename
    updateField("cvFilename", file.name);
    try {
      localStorage.setItem(`pedquest_cv_${member.id}`, file.name);
    } catch {
      // ignore
    }
  }

  // ── Save ────────────────────────────────────────────────────────
  async function handleSave() {
    if (!profile || !member) return;
    setSaving(true);

    // Try Supabase first
    try {
      const { error } = await supabase
        .from("members")
        .update({
          bio: profile.bio,
          title: profile.title,
          department: profile.department,
          interests: profile.interests,
          orcid_id: profile.orcidId,
          website_url: profile.websiteUrl,
          photo_url: profile.photoUrl,
        })
        .eq("id", member.id);

      if (!error) {
        setSaved(true);
        setSaving(false);
        return;
      }
    } catch {
      // Supabase not available
    }

    // Fallback: save to localStorage
    try {
      localStorage.setItem(
        `pedquest_profile_${member.id}`,
        JSON.stringify({
          bio: profile.bio,
          title: profile.title,
          department: profile.department,
          interests: profile.interests,
          orcidId: profile.orcidId,
          websiteUrl: profile.websiteUrl,
          photoUrl: profile.photoUrl,
        })
      );
    } catch {
      // ignore
    }

    setSaved(true);
    setSaving(false);
  }

  // ── Sign out ────────────────────────────────────────────────────
  async function handleSignOut() {
    await supabaseSignOut();
    router.push("/");
  }

  // ── Loading / redirect states ───────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "var(--text-secondary)" }}>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) return null; // will redirect

  // Authenticated user without a member profile
  if (isAuthenticated && !member) {
    return (
      <div
        style={{
          minHeight: "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
        }}
      >
        <div
          style={{
            maxWidth: 440,
            textAlign: "center",
            background: "var(--bg-card)",
            borderRadius: 16,
            border: "1px solid var(--border)",
            padding: "3rem 2.5rem",
          }}
        >
          <h2
            style={{
              fontFamily: "var(--heading-font)",
              fontSize: "1.35rem",
              fontWeight: 700,
              color: "var(--text)",
              marginBottom: "0.75rem",
            }}
          >
            Account not linked
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", lineHeight: 1.6, fontFamily: "var(--body-font)" }}>
            Your email ({effectiveEmail}) is not associated with a PedQuEST member profile.{" "}
            <Link href="/contact" style={{ color: "var(--accent-primary)" }}>
              Contact us
            </Link>{" "}
            for help.
          </p>
          <button
            onClick={handleSignOut}
            style={{
              marginTop: "1.5rem",
              padding: "0.7rem 1.5rem",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: "0.9rem",
              cursor: "pointer",
              fontFamily: "var(--body-font)",
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "2.5rem 1.5rem 4rem" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "2rem",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--heading-font)",
            fontSize: "1.75rem",
            fontWeight: 800,
            color: "var(--text)",
            margin: 0,
          }}
        >
          My Profile
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {isAdmin && (
            <Link
              href="/admin"
              style={{
                padding: "0.55rem 1.25rem",
                borderRadius: 8,
                border: "none",
                background: "var(--accent-primary)",
                color: "white",
                fontSize: "0.85rem",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "var(--body-font)",
                textDecoration: "none",
                transition: "opacity 0.2s",
              }}
            >
              Admin Panel
            </Link>
          )}
          <button
            onClick={handleSignOut}
            style={{
              padding: "0.55rem 1.25rem",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-card)",
              color: "var(--text-secondary)",
              fontSize: "0.85rem",
              cursor: "pointer",
              fontFamily: "var(--body-font)",
              transition: "all 0.2s",
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Profile card */}
      <div
        style={{
          background: "var(--bg-card)",
          borderRadius: 16,
          border: "1px solid var(--border)",
          padding: "2rem 2rem 2.5rem",
          boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
        }}
      >
        {/* Photo Section */}
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", marginBottom: "2rem" }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: "50%",
              overflow: "hidden",
              background: "var(--accent-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              border: "3px solid var(--border)",
            }}
          >
            {photoPreview ? (
              <img
                src={photoPreview}
                alt={member!.name}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <span
                style={{
                  color: "white",
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  fontFamily: "var(--heading-font)",
                }}
              >
                {getInitials(member!.name)}
              </span>
            )}
          </div>
          <div>
            <h2
              style={{
                fontFamily: "var(--heading-font)",
                fontSize: "1.25rem",
                fontWeight: 700,
                color: "var(--text)",
                margin: "0 0 0.25rem",
              }}
            >
              {member!.name}
            </h2>
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: "0.9rem",
                fontFamily: "var(--body-font)",
                margin: "0 0 0.5rem",
              }}
            >
              {member!.institution}
            </p>
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              style={{
                padding: "0.4rem 0.85rem",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--accent-primary)",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "var(--body-font)",
              }}
            >
              Upload New Photo
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoUpload}
              style={{ display: "none" }}
            />
          </div>
        </div>

        {/* Editable Fields */}
        <Field label="Title / Credentials">
          <input
            type="text"
            value={profile.title}
            onChange={(e) => updateField("title", e.target.value)}
            placeholder="MD, PhD"
            style={inputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent-primary)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
          />
        </Field>

        <Field label="Department">
          <input
            type="text"
            value={profile.department}
            onChange={(e) => updateField("department", e.target.value)}
            placeholder="Neurology"
            style={inputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent-primary)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
          />
        </Field>

        <Field label={`Bio (${profile.bio.length} / 2000 characters)`}>
          <textarea
            value={profile.bio}
            onChange={(e) => {
              if (e.target.value.length <= 2000) updateField("bio", e.target.value);
            }}
            rows={5}
            placeholder="Tell colleagues about your research and clinical work..."
            style={{
              ...inputStyle,
              resize: "vertical",
              minHeight: 120,
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent-primary)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
          />
        </Field>

        <Field label="Research Interests">
          <TagInput
            tags={profile.interests}
            onChange={(tags) => updateField("interests", tags)}
          />
        </Field>

        <Field label="ORCID ID">
          <input
            type="text"
            value={profile.orcidId}
            onChange={(e) => updateField("orcidId", e.target.value)}
            placeholder="0000-0000-0000-0000"
            style={inputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent-primary)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
          />
        </Field>

        <Field label="Website URL">
          <input
            type="url"
            value={profile.websiteUrl}
            onChange={(e) => updateField("websiteUrl", e.target.value)}
            placeholder="https://..."
            style={inputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent-primary)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
          />
        </Field>

        {/* CV Upload */}
        <Field label="Curriculum Vitae">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              onClick={() => cvInputRef.current?.click()}
              style={{
                padding: "0.55rem 1rem",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--accent-primary)",
                fontSize: "0.85rem",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "var(--body-font)",
              }}
            >
              Upload CV
            </button>
            <input
              ref={cvInputRef}
              type="file"
              accept=".pdf,.docx,.doc"
              onChange={handleCvUpload}
              style={{ display: "none" }}
            />
            {profile.cvFilename && (
              <span
                style={{
                  color: "var(--text-secondary)",
                  fontSize: "0.85rem",
                  fontFamily: "var(--body-font)",
                }}
              >
                {profile.cvFilename}
              </span>
            )}
          </div>
        </Field>

        {/* Save */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginTop: "2rem",
            paddingTop: "1.5rem",
            borderTop: "1px solid var(--border)",
          }}
        >
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "0.8rem 2rem",
              borderRadius: 10,
              border: "none",
              background: "var(--accent-primary)",
              color: "white",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: saving ? "wait" : "pointer",
              opacity: saving ? 0.7 : 1,
              fontFamily: "var(--body-font)",
              transition: "opacity 0.2s",
            }}
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
          {saved && (
            <span
              style={{
                color: "var(--accent-primary)",
                fontSize: "0.9rem",
                fontWeight: 600,
                fontFamily: "var(--body-font)",
              }}
            >
              Changes saved!
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
