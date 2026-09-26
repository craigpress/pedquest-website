import contracts from "@/data/eeg-contract-reference.json";

export interface EegReference {
  id: string; name: string; aliases: string[]; category: string; definition: string;
  criteria: unknown; context: unknown; pitfalls: unknown; engineering: unknown; status: string;
  source: { title: string; version: string; url: string };
  examples: { title: string; url: string }[];
}

const AES = "https://www.ncbi.nlm.nih.gov/books/NBK390346/";
const NORMAL = "https://www.ncbi.nlm.nih.gov/books/NBK390343/";
const VARIANTS = "https://www.ncbi.nlm.nih.gov/books/NBK390352/";
const ARTIFACTS = "https://www.ncbi.nlm.nih.gov/books/NBK390358/";
const TREND = "https://pmc.ncbi.nlm.nih.gov/articles/PMC4434600/";
function entry(id: string, name: string, aliases: string[], category: string, definition: string, criteria: string[], context: string, pitfalls: string[], url: string, version = "2016"): EegReference {
  return { id, name, aliases, category, definition, criteria, context, pitfalls, engineering: [],
    status: "Editorial draft · verify context with the linked source", source: { title: category === "qEEG" ? "ACNS consensus: continuous EEG technical specifications" : url.includes("ilae.org") ? "ILAE official classification" : url.includes("acns.org") ? "ACNS guidelines" : url.includes("ucl.ac.uk") ? "IFCN revised glossary (2017)" : "AES EEG atlas", version, url },
    examples: [{ title: "Published discussion and examples", url }] };
}

export const EEG_REFERENCES: EegReference[] = [
  entry("ifcn-glossary", "IFCN EEG terminology", ["IFCN"], "Terminology", "Standardized terms for describing clinical EEG and reporting findings.", ["Use waveform description separately from clinical interpretation."], "Clinical EEG terminology", ["A descriptive term alone does not establish a diagnosis."], "https://discovery.ucl.ac.uk/id/eprint/10076640/", "2017"),
  entry("neonatal-monitoring-2025", "ACNS neonatal monitoring indications", ["neonatal monitoring"], "Neonatal EEG", "Current ACNS guidance on indications for continuous EEG monitoring in neonates.", ["Consult the final January 2025 guideline linked from the ACNS index."], "Monitoring indications, distinct from neonatal waveform terminology", ["The 2025 indications guideline does not replace the separate neonatal terminology document."], "https://www.acns.org/practice/guidelines", "2025"),
  ...contracts as EegReference[],
  entry("mu", "Mu rhythm", ["mu rhythm"], "Normal variants", "Central arciform rhythm that can attenuate with movement or sensorimotor activation.", ["Compare central distribution with the posterior dominant rhythm.", "Document the movement interval when claiming blocking."], "Awake sensorimotor context", ["A central alpha-frequency rhythm alone does not demonstrate movement reactivity."], NORMAL),
  entry("lambda", "Lambda waves", ["lambda", "lambda waves"], "Normal variants", "Positive occipital transients associated with visual scanning.", ["Verify occipital field and positive polarity with an appropriate reference."], "Awake visual scanning", ["Do not equate every occipital sharp transient with lambda."], NORMAL),
  entry("wickets", "Wicket waves", ["wickets", "wicket", "wicket waves"], "Normal variants", "Arciform temporal activity occurring singly or in trains.", ["Assess background continuity, temporal field, and absence of a stereotyped epileptiform after-going slow wave."], "Usually drowsiness; developmental context matters", ["A sharp-looking peak alone is insufficient to call an epileptiform discharge."], VARIANTS),
  entry("fourteen-six", "14-and-6 positive bursts", ["14-and-6", "14 and 6", "fourteen_and_six"], "Normal variants", "Brief positive posterior-temporal bursts in drowsiness or light sleep.", ["Use a reference that demonstrates positive polarity; inspect both burst envelope and frequency."], "Common teaching context: adolescents", ["Bipolar phase reversal does not independently establish scalp polarity."], VARIANTS),
  entry("rmtd", "Rhythmic midtemporal theta of drowsiness", ["RMTD", "psychomotor variant"], "Normal variants", "Temporal theta trains without ictal evolution in a drowsy background.", ["Review onset, middle and offset before judging evolution."], "Drowsiness", ["A single cropped train may not distinguish a benign variant from ictal activity."], VARIANTS),
  entry("sreda", "SREDA", ["SREDA"], "Normal variants", "Subclinical rhythmic EEG discharge of adults, a seizure mimic with a characteristic clinical and electrographic context.", ["Assess bilateral distribution, evolution and clinical state."], "Predominantly adults", ["Adult-only generation eligibility is a teaching policy, not a claim of biological impossibility in younger people."], VARIANTS),
  entry("photic-driving", "Photic driving", ["photic driving", "photic_driving"], "Activation", "Posterior rhythmic response related to the flash rate or its harmonics.", ["Show stimulus frequency and timing."], "Photic stimulation", ["Driving is distinct from a photoparoxysmal response."], NORMAL),
  entry("hv-buildup", "Hyperventilation buildup", ["hyperventilation buildup", "hyperventilation_buildup"], "Activation", "Increased slow activity during hyperventilation, particularly prominent in children.", ["Review pre-activation baseline, activation and recovery."], "Age and cooperation dependent", ["Do not classify rhythmic slowing as an absence seizure without appropriate electroclinical evidence."], NORMAL),
  entry("posts", "Positive occipital sharp transients of sleep", ["POSTS"], "Normal variants", "Positive occipital sleep transients, sometimes in trains.", ["Demonstrate occipital field and positive polarity."], "Sleep", ["Distinguish from awake visual-scanning lambda transients."], NORMAL),
  entry("hypnagogic-hypersynchrony", "Hypnagogic hypersynchrony", ["hypnagogic hypersynchrony"], "Developmental EEG", "Prominent synchronous slow activity during childhood drowsiness.", ["Evaluate diffuse distribution, state transition and waveform morphology."], "Age-dependent drowsiness pattern", ["Do not add spikes solely to make the rhythm conspicuous."], "https://www.ncbi.nlm.nih.gov/books/NBK390356/"),
  entry("hypsarrhythmia", "Hypsarrhythmia", ["hypsarrhythmia"], "Developmental EEG", "Disorganized high-amplitude slow activity with multifocal epileptiform discharges.", ["Assess organization, multifocality, amplitude and state dependence."], "Infantile epileptic spasms context", ["High voltage alone does not establish hypsarrhythmia; spasms need separate electroclinical assessment."], AES),
  entry("ocular-artifact", "Ocular artifact", ["blink", "blinks", "lateral_eye", "slow_roving_eye", "rem_eye_movements"], "Artifacts", "Eye-generated potentials with a characteristic frontal field.", ["Distinguish vertical blinks from opposed lateral fields; document EOG or behavior when available."], "State and eye-movement dependent", ["Eye movements alone cannot establish REM sleep."], ARTIFACTS),
  entry("cardiac-artifact", "ECG and pulse artifact", ["ECG", "EKG", "pulse artifact"], "Artifacts", "Electrical cardiac contamination and mechanical pulse artifact are different phenomena.", ["Compare timing with an ECG channel before asserting cardiac coupling."], "Any state", ["A periodic waveform without an ECG reference does not prove pulse locking."], ARTIFACTS),
  entry("muscle-artifact", "Muscle and chewing artifact", ["EMG", "emg_chewing", "chewing"], "Artifacts", "Muscle activity can introduce fast activity and contaminate spectral trends.", ["Compare spatial distribution and raw waveform with high-frequency power."], "Movement, tension or chewing", ["Neuromuscular blockade removes modeled muscle, not all mechanical or electrical artifacts."], ARTIFACTS),
  entry("technical-artifact", "Electrode and environmental artifacts", ["electrode_pop", "electrode pop", "sweat", "sixty_hz", "60 Hz", "ventilator", "glossokinetic"], "Artifacts", "Noncerebral signals can imitate slow waves, sharp transients or rhythmic activity.", ["Inspect electrode field, frequency, onset/decay, filters and external timing."], "Recording conditions", ["Filtering may hide an artifact without removing its cause."], ARTIFACTS),
  entry("fft-spectrogram", "FFT spectrogram / CDSA", ["FFT", "CDSA", "spectrogram", "DSA"], "qEEG", "A time-frequency representation of signal power.", ["Read frequency, time and color scale together; verify derivation, FFT window and overlap."], "Computed trend", ["Artifact and changing scales can mimic brain-state changes."], TREND, "2015"),
  entry("aeeg", "Amplitude-integrated EEG", ["aEEG", "amplitude integrated EEG"], "qEEG", "A compressed amplitude display whose envelope depends on filtering, derivation and processing.", ["Inspect upper/lower margins and raw EEG at matching times."], "Neonatal and critical-care applications", ["Not interchangeable with the unprocessed amplitude envelope; focal seizures may be missed."], TREND, "2015"),
  entry("suppression-ratio", "Suppression ratio", ["suppression ratio", "BSR", "SR", "suppression_ratio_global", "suppression_ratio_L", "suppression_ratio_R"], "qEEG", "Fraction of a specified analysis interval meeting the algorithm's suppression rule.", ["Report voltage rule, epoch length, averaging window and derivation."], "Algorithm-specific trend", ["Viewer engine3 uses peak-to-peak <6 µV (twice its3 µV threshold constant),0.5s epochs and60s windows. Python-renderer defaults use5 µV peak-to-peak. Neither is interchangeable with ACNS visual background suppression criteria."], TREND, "2015"),
  entry("adr", "Alpha/delta ratio", ["ADR", "alpha delta ratio", "alpha-delta ratio"], "qEEG", "Alpha-band power divided by delta-band power under stated band definitions.", ["Inspect numerator, denominator and raw EEG; retain units and aggregation settings."], "Computed trend", ["A low denominator, artifact or medication effect can change the ratio."], TREND, "2015"),
  entry("asymmetry", "Quantitative asymmetry", ["asymmetry index", "relative asymmetry"], "qEEG", "A defined comparison of homologous left/right signal measurements.", ["State formula, sign convention, bands and montage."], "Computed trend", ["A bipolar power index is not the ACNS referential voltage-symmetry criterion."], TREND, "2015"),
  entry("total-power", "Total power", ["total power"], "qEEG", "Power integrated across a stated frequency range.", ["Specify band limits, units and derivation."], "Site viewer: 1–20 Hz, µV²", ["Do not compare numerical values across different bands or references."], TREND, "2015"),
  entry("rhythmicity", "Rhythmicity trend", ["rhythmicity"], "qEEG", "An algorithm-dependent measure of sustained rhythmic signal structure.", ["Inspect the actual algorithm and aligned raw EEG before assigning a clinical label."], "Computed trend", ["Rhythmic artifact and nonictal rhythms may produce strong values."], TREND, "2015"),
  entry("theta-delta-ratio", "Theta/delta ratio", ["theta delta ratio", "theta_delta_ratio", "theta_delta_ratio_L", "theta_delta_ratio_R"], "qEEG", "Theta-band power divided by delta-band power under stated band definitions.", ["State frequency bands, montage and smoothing; compare both underlying powers."], "Computed trend", ["A ratio change alone does not identify a cause or seizure."], TREND, "2015"),
  entry("amplitude-envelope", "Amplitude envelope", ["envelope_L", "envelope_R", "amplitude envelope"], "qEEG", "A time-varying summary of signal amplitude after specified processing.", ["State filtering, rectification or analytic-envelope method, smoothing and units."], "Python renderer uses separate2–20Hz processing", ["An envelope is not automatically an amplitude-integrated EEG display."], TREND, "2015"),
  entry("seizure-probability", "Seizure probability / detector illustration", ["seizure_probability", "seizure probability"], "qEEG", "A detector output whose interpretation depends on algorithm validation and calibration.", ["Review aligned raw EEG for every apparent detection."], "The site's plotted heuristic is an educational illustration", ["This heuristic is not a calibrated probability, validated seizure detector, or commercial detector implementation."], TREND, "2015"),
  entry("baseline-change", "Change from baseline", ["vs baseline", "baseline normalized", "baseline change"], "qEEG", "A comparison with a selected reference interval using stated arithmetic.", ["Show reference interval; distinguish dB power differences from percentage scalar changes."], "Viewer-derived display", ["An abnormal or artifact-contaminated baseline can conceal or exaggerate changes."], TREND, "2015"),
  entry("seizure-classification-2025", "ILAE seizure classification (2025)", ["focal seizure", "generalized seizure", "unknown whether focal or generalized"], "Seizure classification", "The current ILAE classification retains focal, generalized, unknown whether focal or generalized, and unclassified seizures.", ["Keep seizure classification distinct from an EEG pattern label.", "Preserved/impaired consciousness requires clinical evidence."], "Use the separate neonatal framework for neonates", ["Do not infer awareness or responsiveness from synthetic EEG alone."], "https://www.ilae.org/files/dmfile/updated-classification-of-epileptic-seizures-2025.pdf", "2025"),
  entry("neonatal-seizure-classification", "ILAE neonatal seizure framework", ["neonatal seizure"], "Neonatal EEG", "The neonatal framework emphasizes EEG-confirmed seizures and distinguishes electrographic-only from electroclinical events.", ["Document EEG evidence and available clinical correlate."], "Neonates", ["An isolated clinical movement without EEG evidence is not automatically an epileptic seizure."], "https://www.ilae.org/files/ilaeGuideline/Classification-of-seizures---modification-for-neonates-epi.16815-2021-02.pdf", "2021"),
];

export type FeatureMention = { id: string; term: string; basis: "explicit_tag" | "mentioned" | "uncertain" | "negated" };
const PANEL_ALIASES: Record<string,string[]> = {
  "fft-spectrogram": ["fft_L","fft_R","fft_LL","fft_LP","fft_RP","fft_RL"],
  "aeeg": ["aeeg_L","aeeg_R"], "rhythmicity": ["rhythmicity_L","rhythmicity_R"],
  "adr": ["alpha_delta_ratio","alpha_delta_ratio_L","alpha_delta_ratio_R","alpha_delta_ratio_lateral","alpha_delta_ratio_parasagittal"],
  "theta-delta-ratio": ["theta_delta_ratio_lateral","theta_delta_ratio_parasagittal"],
  "asymmetry": ["asymmetry_relative","asymmetry_index"], "total-power": ["total_power_L","total_power_R"],
};
// Page numbers refer to the ACNS-linked 2021 EEG examples supplement.
const ACNS_EXAMPLES: Record<string, [string, number][]> = {
  "bg-continuity": [["Burst attenuation · EEG 1", 2], ["Burst suppression · EEG 2", 3]],
  "bg-burst-modifiers": [["Identical highly epileptiform bursts · EEG 3", 4]],
  "rpp-location": [["Lateralized periodic discharges", 9], ["Bilateral independent periodic discharges", 10]],
  "rpp-type": [["Generalized periodic discharges", 6], ["Generalized rhythmic delta", 7], ["Generalized spike-and-wave", 15]],
  "rpp-stimulus-evolution": [["Evolution · EEG 16", 17], ["Fluctuation · EEG 17", 18]],
  "rpp-plus": [["Extreme delta brush · EEG 22", 23]],
  "rpp-minor": [["Triphasic morphology and lag · EEG 23", 24]],
  "sz-esz": [["Electrographic seizure · EEG 24", 25]],
  "sz-ecsz": [["Electroclinical seizure · EEG 25", 28]],
  "sz-birds": [["BIRDs · EEG 27", 31]],
  "sz-iic": [["Focal ictal-interictal continuum · EEG 28", 32]],
};
for (const ref of EEG_REFERENCES) {
  ref.aliases.push(...(PANEL_ALIASES[ref.id] ?? []));
  if (ACNS_EXAMPLES[ref.id]) ref.examples = ACNS_EXAMPLES[ref.id].map(([title, page]) => ({
    title: `${title} · PDF p. ${page}`,
    url: `https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=${page}`,
  }));
  if (ref.id === "neonatal-monitoring-2025") {
    ref.source.url = "https://journals.lww.com/clinicalneurophys/fulltext/2025/01000/the_american_clinical_neurophysiology_society.1.aspx";
    ref.source.title = "ACNS neonatal monitoring guideline (publisher access)";
    ref.examples = [];
  }
}
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[_–—-]/g, " ").toLowerCase();
export function matchEegFeatures(text: string, tags: string[] = []): FeatureMention[] {
  const normalized = normalize(text);
  const result: FeatureMention[] = [];
  for (const ref of EEG_REFERENCES) {
    const terms = [ref.id, ref.name, ...ref.aliases];
    if (tags.some((tag) => terms.some((term) => normalize(tag) === normalize(term)))) {
      result.push({ id: ref.id, term: ref.name, basis: "explicit_tag" }); continue;
    }
    for (const term of terms) {
      const needle = normalize(term);
      // Short abbreviations require matching case, preventing ordinary 'sr'/'stop' words.
      if (term.length <= 4 && !text.includes(term)) continue;
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(?:^|[^a-z0-9])(${escaped})(?=$|[^a-z0-9])`, "g");
      const matches = [...normalized.matchAll(re)];
      if (!matches.length) continue;
      const bases = matches.map((m) => {
        const clause = normalized.slice(0, m.index).split(/[.;!?\n]|\bbut\b|\bhowever\b/).pop() ?? "";
        const after = normalized.slice((m.index ?? 0) + m[0].length).split(/[.;!?\n]/)[0];
        if (/^\s+(?:(?:is|are|was|were)\s+)?(?:absent|not present|not seen|ruled out)\b/.test(after)) return "negated" as const;
        if (/\b(no|not|without|absent|denies|negative for)\b/.test(clause)) return "negated" as const;
        if (/\b(possible|possibly|suspected|uncertain|rule out|query|may|versus)\b/.test(clause)) return "uncertain" as const;
        return "mentioned" as const;
      });
      result.push({ id: ref.id, term: ref.name, basis: bases.every((b) => b === "negated") ? "negated" : bases.every((b) => b === "mentioned") ? "mentioned" : "uncertain" });
      break;
    }
  }
  return result;
}
