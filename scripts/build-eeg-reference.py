"""Build the public reference subset; never copy private source paths or PDFs."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
contracts = json.loads((ROOT / "docs/EEG_ATLAS_FEATURE_CONTRACTS.json").read_text(encoding="utf-8-sig"))
register = json.loads((ROOT / "docs/EEG_ATLAS_SOURCE_REGISTER.json").read_text(encoding="utf-8-sig"))
sources = {s["id"]: s for s in register["sources"]}
aliases = {
 "BG-PDR": ["PDR", "posterior dominant rhythm"], "BG-CONTINUITY": ["burst suppression", "burst attenuation", "discontinuous"],
 "BG-CAPE": ["CAPE"], "BG-BREACH": ["breach rhythm"], "BG-STATE-CHANGES": ["sleep spindles", "K complexes"],
 "SED-MORPHOLOGY": ["spike", "spikes", "sharp wave", "polyspikes"],
 "SZ-ESZ": ["electrographic seizure", "ESz"], "SZ-ESE": ["electrographic status epilepticus", "ESE"],
 "SZ-ECSZ": ["electroclinical seizure"], "SZ-BIRDS": ["BIRDs"], "SZ-IIC": ["IIC", "ictal interictal continuum"],
 "RPP-LOCATION": ["LPD", "LPDs", "GPD", "GPDs", "BIPDs", "LRDA", "GRDA"],
 "RPP-PLUS": ["extreme delta brush"], "NEO-CONTINUITY-NORMAL": ["tracé alternant", "trace alternant", "tracé discontinu", "trace discontinu"],
 "NEO-GRAPHOELEMENTS": ["delta brushes", "encoches frontales", "STOP", "temporal theta"],
 "NEO-SHARP-TRANSIENTS": ["positive sharp waves", "PSWY"], "NEO-BRD": ["BRD", "brief rhythmic discharge"],
}
entries = []
definitions = {
 "SZ-ESZ": "An EEG event that meets the ACNS electrographic seizure criteria through discharge rate or definite evolution and duration.",
 "SZ-ESE": "Electrographic seizures meeting the ACNS continuous-duration or cumulative hourly-burden criteria for status.",
 "SZ-ECSZ": "An EEG pattern with a definite time-linked clinical correlate, or both EEG and clinical improvement after parenteral antiseizure medication.",
 "SZ-ECSE": "Electroclinical seizures meeting status-duration or hourly-burden criteria, with a separate threshold for ongoing bilateral tonic-clonic activity.",
 "SZ-POSSIBLE-ECSE": "A qualifying prolonged ictal-interictal continuum pattern that improves electrographically after parenteral antiseizure medication without clinical improvement.",
 "SZ-NONCONVULSIVE": "A qualifier indicating that a seizure or status event lacks prominent motor activity; it does not mean there is no clinical correlate.",
 "SZ-SI": "A qualifier for a qualifying pattern reproducibly induced or exacerbated by an alerting stimulus.",
 "SZ-BIRDS": "Brief potentially ictal rhythmic discharges with specified frequency, duration and morphology/context requirements.",
 "SZ-IIC": "EEG patterns that do not meet definite seizure criteria but may contribute to impaired alertness, symptoms or neuronal injury in the appropriate clinical context.",
 "REP-MINIMUM": "Recommended review, communication and reporting context for critical-care EEG.",
 "REP-BURDEN": "Measures of the duration or frequency-weighted duration of a pattern over an explicitly defined reporting interval.",
}
for c in contracts["contracts"]:
    s = sources[c["source"]["source_id"]]
    pages = c["source"].get("pdf_pages", [])
    url = s["url"] + (f"#page={pages[0]}" if pages else "")
    entries.append(dict(id=c["id"].lower(), name=c["name"], aliases=aliases.get(c["id"], []),
        category="Neonatal EEG" if c["id"].startswith("NEO") else "Critical-care EEG",
        definition=definitions.get(c["id"], c["definition"]), criteria=c["criteria"], context=c["applicability"],
        pitfalls=c.get("exclusions", []), engineering=c.get("engineering_choices", []),
        status="Source-extracted draft · clinical editorial review pending",
        source={"title":s["title"], "version":s["version"], "url":url},
        examples=[{"title":"Official source: figures and examples", "url":url}]))
(ROOT / "src/data/eeg-contract-reference.json").write_text(json.dumps(entries, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
print(f"Built {len(entries)} source-linked contracts")
