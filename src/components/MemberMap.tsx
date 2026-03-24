"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { members, institutions } from "@/data/members";
import type { Member } from "@/data/members";
import Link from "next/link";

// Group members by institution
function getMembersByInstitution(): Map<string, Member[]> {
  const map = new Map<string, Member[]>();
  for (const m of members) {
    const existing = map.get(m.institution) || [];
    existing.push(m);
    map.set(m.institution, existing);
  }
  return map;
}

function createPinIcon(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
    <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.27 21.73 0 14 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="14" cy="14" r="6" fill="#fff"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    iconSize: [28, 40],
    iconAnchor: [14, 40],
    popupAnchor: [0, -36],
    className: "",
  });
}

export default function MemberMap() {
  const [pinColor, setPinColor] = useState("#d4603a");

  useEffect(() => {
    const color = getComputedStyle(document.documentElement)
      .getPropertyValue("--map-pin")
      .trim();
    if (color) setPinColor(color);
  }, []);

  const membersByInstitution = getMembersByInstitution();
  const icon = createPinIcon(pinColor);

  return (
    <MapContainer
      center={[30, -40]}
      zoom={3}
      minZoom={2}
      maxZoom={12}
      scrollWheelZoom={true}
      style={{ height: "450px", width: "100%", borderRadius: "16px" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {institutions.map((inst) => {
        const instMembers = membersByInstitution.get(inst.name) || [];
        return (
          <Marker key={inst.name} position={[inst.lat, inst.lng]} icon={icon}>
            <Popup>
              <div style={{ fontFamily: "var(--body-font)", minWidth: "180px" }}>
                <strong style={{ fontSize: "0.95rem", display: "block", marginBottom: "4px" }}>
                  {inst.name}
                </strong>
                <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  {inst.city}, {inst.country}
                </span>
                {instMembers.length > 0 && (
                  <ul style={{ margin: "8px 0 0", padding: "0 0 0 16px", fontSize: "0.85rem" }}>
                    {instMembers.map((m) => (
                      <li key={m.id} style={{ marginBottom: "2px" }}>
                        <Link href={`/members/${m.id}`} style={{ color: "var(--accent-primary)" }}>
                          {m.name}, {m.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
