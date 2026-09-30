// Content of the EEG Lab authoring guide (/admin/eeg-lab/guide).
//
// Written for neurologists and EEG colleagues: clinical language only. The
// `names` on each control are the renderer's field names; they are shown only
// behind the "Expert-mode names" toggle and are what guide-content.test.ts and
// tools/eeg-render/tests/test_guide_coverage.py check coverage against.
// `optionSet` names the Lab option list a control documents, so a new option in
// src/lib/lab/spec.ts fails the test until it is described here.

import coverage from "./guide-coverage.json";
import type { LabAgeBand } from "./types";

export const GUIDE_RENDERER_VERSION: string = coverage.rendererVersion;
export const GUIDE_UPDATED = "27 September 2026";

export interface GuideOption {
  value: string;
  label: string;
  text: string;
}

export interface GuideControl {
  id: string;
  name: string;
  /** Label of the field in the Guided form, when the form offers it. */
  formLabel?: string;
  /** "form" = in the Guided form; "advanced" = Expert mode only. */
  where: "form" | "advanced";
  what: string;
  range?: string;
  options?: GuideOption[];
  /** The Lab option list this control documents (checked by the test). */
  optionSet?: string;
  defaultText: string;
  onPage: string;
  onTrends?: string;
  /** Renderer field names: "rec:x" recording, "bg:x" background, "event:x" event type, "field:x" event setting. */
  names: string[];
}

export interface GuideSection {
  id: string;
  title: string;
  summary: string;
  intro: string[];
  controls: GuideControl[];
  notes?: string[];
}

export interface GuideStep {
  label: string;
  detail: string;
}

export interface GuideWalkthrough {
  id: string;
  title: string;
  teaches: string;
  steps: GuideStep[];
  expect: string[];
}

export interface AgeDefaultRow {
  id: LabAgeBand;
  age: string;
  dominantHz: number;
  amplitudeUv: number;
  amplitudeNote?: string;
  slowFraction: number;
  background: string;
  blinks: string;
}

const o = (value: string, label: string, text: string): GuideOption => ({ value, label, text });

// ── overview ───────────────────────────────────────────────────────────────

export const GUIDE_INTRO: string[] = [
  "Every recording made in the EEG Lab is synthetic. No patient data is used or stored; the signal is generated from the settings you choose, for teaching. It is drawn to look and measure like the clinical pattern it represents, but it is not a patient recording and not a validated simulation of any individual.",
  "You describe a case in three layers: the recording settings (age, electrodes, length), the background that runs between events, and timed events such as seizures, periodic discharges, sedation changes, stimulation and artifacts. Anything you leave blank takes the default listed here, chosen for the age and background you picked.",
  "Each control below says what it is, what you can choose, the default if you leave it blank, and what a reader will see on the EEG page and on the quantitative trends.",
];

export const GUIDE_READING_NOTES: string[] = [
  "\"In the Guided form\" controls have a field in the Lab's Guided view. \"Expert mode\" controls are available when you write the full recording description in the Expert view; switch on \"Show Expert-mode names\" to see the name each one uses there.",
  "Amplitudes are peak-to-peak microvolts as a reader measures them on the longitudinal bipolar page, unless a control says otherwise.",
  "Times are minutes from the start of the recording unless the unit says seconds.",
  "Renderer defaults: new forms start at edition 3, which everything in this guide describes. Editions 1 and 2 exist so older question-bank recordings render exactly as they were reviewed; a choice that needs edition 3 moves the form back to it.",
];

export const AGE_DEFAULTS_TABLE: AgeDefaultRow[] = [
  { id: "neonate", age: "Neonate", dominantHz: 1.5, amplitudeUv: 60, amplitudeNote: "or set by postmenstrual age in Expert mode", slowFraction: 0.8, background: "Discontinuous", blinks: "None unless a sleep–wake cycle is on; then about 2/min, awake only" },
  { id: "infant", age: "Infant", dominantHz: 5.5, amplitudeUv: 55, slowFraction: 0.55, background: "Continuous", blinks: "15/min awake" },
  { id: "child", age: "Child", dominantHz: 8, amplitudeUv: 90, amplitudeNote: "continuous background; 45 µV for other background types", slowFraction: 0.4, background: "Continuous", blinks: "15/min awake" },
  { id: "adolescent", age: "Adolescent", dominantHz: 9.5, amplitudeUv: 35, slowFraction: 0.3, background: "Continuous", blinks: "15/min awake" },
  { id: "adult", age: "Adult", dominantHz: 10, amplitudeUv: 30, slowFraction: 0.25, background: "Continuous", blinks: "15/min awake" },
];

export const AGE_DEFAULTS_NOTE =
  "These are starting points for teaching, not population reference ranges. The Guided form fills the dominant frequency, amplitude and slow fraction for the age and background type you pick, and keeps following them until you type your own value. Values are for renderer defaults edition 3; at editions 1 and 2 a child background starts at 45 µV. Hypsarrhythmia starts at 1.3 Hz, 280 µV and slow fraction 0.95. Suppressed, low-voltage and burst-suppression backgrounds use the age value, which the recording scales down to a physiologic voltage.";

// ── sections ───────────────────────────────────────────────────────────────

const REGION_OPTIONS: GuideOption[] = [
  o("left_temporal", "Left temporal", "Neocortical temporal maximum at T3/T5."),
  o("right_temporal", "Right temporal", "Neocortical temporal maximum at T4/T6."),
  o("left_mesial_temporal", "Left mesial temporal", "Anterior temporal maximum at F7 (T1 when the subtemporal pair is recorded); rhythmic theta from the first second."),
  o("right_mesial_temporal", "Right mesial temporal", "Anterior temporal maximum at F8 (T2 when recorded)."),
  o("left_frontal", "Left frontal", "Maximum at F3/F7."),
  o("right_frontal", "Right frontal", "Maximum at F4/F8."),
  o("left_central", "Left central", "Maximum at C3."),
  o("right_central", "Right central", "Maximum at C4."),
  o("left_parietal", "Left parietal", "Maximum at P3."),
  o("right_parietal", "Right parietal", "Maximum at P4."),
  o("left_occipital", "Left occipital", "Maximum at O1."),
  o("right_occipital", "Right occipital", "Maximum at O2."),
  o("left_hemisphere", "Left hemisphere", "Broad field over the whole left side."),
  o("right_hemisphere", "Right hemisphere", "Broad field over the whole right side."),
  o("midline", "Midline", "Maximum at Fz/Cz/Pz."),
  o("generalized", "Generalized", "Bilateral, synchronous, frontally predominant field."),
];

const recording: GuideSection = {
  id: "recording",
  title: "Recording settings",
  summary: "Whose EEG, which electrodes, how long, and how it is drawn.",
  intro: [
    "These set the patient's age and the recording's length and electrode coverage. Age is the most influential single choice: it sets the starting background frequency, voltage, slow activity, blink rate and sleep-cycle length.",
  ],
  controls: [
    {
      id: "age", name: "Age band", formLabel: "Age band", where: "form", optionSet: "AGE_BANDS",
      what: "The age group being simulated.",
      options: [
        o("neonate", "Neonate", "Discontinuous or tracé alternant patterns set by postmenstrual age; neonatal graphoelements and delta brushes."),
        o("infant", "Infant", "Continuous 5–6 Hz background; infant sleep cycles of about 55 minutes."),
        o("child", "Child", "Continuous background with an 8 Hz posterior dominant rhythm; about 90 µV awake on the bipolar page."),
        o("adolescent", "Adolescent", "9–10 Hz posterior rhythm, lower voltage, 90-minute sleep cycles."),
        o("adult", "Adult", "10 Hz posterior rhythm, about 30 µV. Adult presets are for comparison teaching and have had less review than the pediatric ones."),
      ],
      defaultText: "Child.",
      onPage: "Sets the starting frequency, voltage and organization of the background (see the table of age defaults).",
      onTrends: "Shifts the spectrogram peak and the aEEG margins to the age-typical range.",
      names: ["rec:age_group"],
    },
    {
      id: "channels", name: "Electrode set", formLabel: "Channel set", where: "form", optionSet: "CHANNEL_SETS",
      what: "Which scalp electrodes are recorded.",
      options: [
        o("standard_19", "Standard 19 (10–20)", "The full international 10–20 array."),
        o("neonatal_9", "Neonatal reduced (9)", "The reduced neonatal array (Fp1/Fp2, C3/C4, T3/T4, O1/O2, Cz)."),
        o("standard_19_t1t2", "Standard 19 + T1/T2", "The 10–20 array plus the subtemporal pair, for mesial temporal teaching. Chosen automatically when you pick the longitudinal montage with T1/T2."),
      ],
      defaultText: "Standard 19.",
      onPage: "Only recorded electrodes can appear in a montage. A neonatal case on the full array shows 19 channels; on the reduced array it shows the neonatal montage.",
      names: ["rec:channels"],
    },
    {
      id: "montage", name: "Montage", formLabel: "Montage", where: "form", optionSet: "MONTAGES",
      what: "The montage used for rendered pages and figures, and for locating events in the answer key. Learners can still change montage in the viewer or review station.",
      options: [
        o("longitudinal_bipolar", "Longitudinal bipolar", "Double banana. Phase reversals localize a focus."),
        o("transverse_bipolar", "Transverse bipolar", "Left-to-right chains; useful for midline and parasagittal fields."),
        o("circumferential", "Circumferential (hatband)", "A ring around the head; shows temporal fields end to end."),
        o("grapefruit", "Grapefruit", "Concentric bipolar rings: an outer temporal ring, an inner parasagittal ring and the midline."),
        o("t1t2_bipolar", "Longitudinal with T1/T2", "Temporal chains including the subtemporal electrodes; needs the T1/T2 electrode set."),
        o("referential", "Referential", "Each electrode to a common reference. Amplitude maximum localizes; polarity is read directly."),
        o("average", "Average reference", "Each electrode to the average of all scalp electrodes."),
        o("ipsilateral_ear", "Ipsilateral ear", "Each electrode to the ear on the same side; ear activity (for example temporal discharges) can contaminate the reference."),
        o("contralateral_ear", "Contralateral ear", "Each electrode to the opposite ear."),
        o("cz_reference", "Cz reference", "Each electrode to Cz; vertex waves and central activity distort it."),
        o("laplacian", "Laplacian", "Each electrode to the weighted average of its neighbours; sharpens focal fields and suppresses broad ones."),
        o("neonatal_reduced", "Neonatal reduced", "The standard neonatal bipolar montage for the 9-electrode array."),
        o("neonatal_average", "Neonatal average", "Average reference over the neonatal array."),
      ],
      defaultText: "Longitudinal bipolar.",
      onPage: "Changes how the same voltages look. Broad fields partly cancel in bipolar chains and are clearest referentially; focal discharges phase-reverse in bipolar chains. A montage never creates or removes a cerebral event.",
      names: ["rec:montage"],
    },
    {
      id: "sample-rate", name: "Sampling rate", formLabel: "Sample rate", where: "form", optionSet: "SAMPLE_RATES",
      what: "Samples per second in the exported recording.",
      options: [
        o("200", "200 Hz", "What the Persyst runs were validated with; smallest files."),
        o("256", "256 Hz", "Common clinical rate."),
        o("512", "512 Hz", "For fast activity and high-frequency detail; files are larger."),
      ],
      defaultText: "200 Hz in the form (256 Hz if left out in Expert mode).",
      onPage: "Little visible difference at routine display settings. Changing it produces a different recording, even with the same variation number.",
      names: ["rec:sample_rate"],
    },
    {
      id: "duration", name: "Recording length", formLabel: "Duration (minutes)", where: "form", optionSet: "DURATION",
      what: "Length of the whole recording.",
      range: "30 to 2880 minutes (48 hours).",
      defaultText: "120 minutes in the form.",
      onPage: "Longer recordings allow sleep cycles, clusters and slow trends. Persyst trend processing needs at least 10 minutes before its baseline is valid.",
      onTrends: "Sets the time axis of every trend panel.",
      names: ["rec:duration_min"],
    },
    {
      id: "defaults-edition", name: "Renderer defaults", formLabel: "Renderer defaults", where: "form", optionSet: "EDITIONS",
      what: "Which generation of defaults fills anything you leave blank.",
      options: [
        o("1", "Edition 1", "The defaults the original question bank was reviewed with."),
        o("2", "Edition 2", "Intermediate defaults (display-referenced amplitude, recruiting seizures)."),
        o("3", "Edition 3 (current)", "Everything described in this guide: review-station display filter, realistic blinks and eye state, sleep staging, ACNS patterns, generalized seizure types, polarity and the full montage set."),
      ],
      defaultText: "Edition 3 for a new form. Older recordings keep the edition they were made with.",
      onPage: "Editions 1 and 2 keep older recordings identical to what was reviewed. Most of the realism described here applies only in edition 3.",
      names: ["rec:spec_version"],
    },
    {
      id: "variation", name: "Variation number", formLabel: "Variation number", where: "form",
      what: "A whole number that fixes the random detail of the recording: exact timing of each discharge, each blink and each burst.",
      defaultText: "A random number is filled in when the form opens.",
      onPage: "The same number with the same settings reproduces the recording exactly. Change only this number to get a different-looking example of the same case.",
      names: ["rec:seed"],
    },
    {
      id: "annotations", name: "Annotations", where: "form",
      what: "Text notes at a time point, like a technologist's log (\"patient suctioned\", \"eyes open\"). Up to 60 characters each.",
      defaultText: "None.",
      onPage: "Shown as text marks at that time. They do not change the EEG. Never write the diagnosis or the answer in an annotation.",
      names: ["rec:annotations"],
    },
    {
      id: "output", name: "Recording format", formLabel: "Format", where: "form", optionSet: "LAB_FORMATS",
      what: "The file type made for learners to open in a review station.",
      options: [
        o("lay", "Persyst .lay / .dat", "Opens in Persyst; the format used for Persyst trend processing."),
        o("edf", "EDF+", "Portable copy for EDFbrowser and other readers."),
      ],
      defaultText: "Persyst .lay / .dat (both can be chosen).",
      onPage: "Learner downloads contain the signal and trends only. The answer key and the Persyst trend table are instructor-only downloads.",
      names: [],
    },
    {
      id: "persyst", name: "Persyst processing", formLabel: "MMX preset / Export panel", where: "form", optionSet: "PERSYST",
      what: "Optional Persyst trend processing of the finished recording, using a stock trend settings file and a panel to export.",
      options: [
        o("Trend Settings Version P15.mmx", "P15 trend settings", "Current Persyst trend settings."),
        o("Trend Settings Version P14.mmx", "P14 trend settings", "Previous Persyst trend settings."),
        o("VsBaseline Comprehensive", "VsBaseline Comprehensive panel", "Trends relative to the recording's own baseline."),
        o("Comprehensive", "Comprehensive panel", "The standard comprehensive trend panel."),
        o("Seizure Probability", "Seizure Probability panel", "Persyst seizure probability only (instructor copy, because it points at the answer)."),
      ],
      defaultText: "Off unless requested.",
      onPage: "No change to the EEG. Produces a Persyst trend table alongside the recording.",
      names: [],
    },
  ],
};

const background: GuideSection = {
  id: "background",
  title: "Background",
  summary: "What runs between events: continuity, frequency, voltage and organization.",
  intro: [
    "The background is the activity every event is superimposed on. Its type sets continuity; frequency, amplitude and slow fraction set its character. The Guided form offers the essentials; Expert mode adds asymmetry, breach, gradient and long-term changes.",
  ],
  controls: [
    {
      id: "bg-type", name: "Background type", formLabel: "Type", where: "form", optionSet: "BACKGROUND_TYPES",
      what: "The continuity pattern of the background.",
      options: [
        o("continuous", "Continuous", "Uninterrupted activity; the normal pattern beyond the neonatal period."),
        o("discontinuous", "Discontinuous", "Bursts separated by lower-voltage interburst periods (about a third of the time); normal for young preterm neonates."),
        o("excessively_discontinuous", "Excessively discontinuous", "Longer, flatter interburst periods than expected for age."),
        o("trace_alternant", "Tracé alternant", "Term quiet-sleep pattern: 3–8 s bursts alternating with lower-voltage (not suppressed) periods of similar length."),
        o("burst_suppression", "Burst suppression", "Bursts separated by suppression below about 10 µV; burst and interburst length set in the form."),
        o("suppressed", "Suppressed", "Voltage persistently below 10 µV."),
        o("low_voltage", "Low voltage", "Continuous but mostly below 20 µV."),
        o("hypsarrhythmia", "Hypsarrhythmia", "Very high-voltage (about 280 µV), chaotic, asynchronous slow activity with multifocal spikes; fragments in sleep."),
      ],
      defaultText: "Continuous (discontinuous for neonates).",
      onPage: "Sets how much of each page is active versus low-voltage.",
      onTrends: "Discontinuity widens the aEEG band and lowers its lower margin; suppression raises the suppression ratio.",
      names: ["bg:type"],
    },
    {
      id: "bg-dominant", name: "Dominant frequency", formLabel: "Dominant Hz", where: "form",
      what: "Frequency of the main rhythm; in awake older children and adults this is the posterior dominant rhythm.",
      range: "0.3 to 20 Hz.",
      defaultText: "By age (1.5, 5.5, 8, 9.5, 10 Hz); the form fills it for the age you pick.",
      onPage: "The posterior rhythm frequency with eyes closed, attenuating with eyes open.",
      onTrends: "The spectrogram's awake peak.",
      names: ["bg:dominant_hz"],
    },
    {
      id: "bg-amplitude", name: "Background amplitude", formLabel: "Amplitude µV", where: "form",
      what: "The awake background voltage a reader would measure peak-to-peak on the longitudinal bipolar page (median over one-second windows, away from blinks). The recording calibrates itself to this.",
      range: "Any positive value in µV.",
      defaultText: "By age and background type: 90 µV for a continuous child background (normal awake child 80–100 µV on the bipolar page); otherwise 60, 55, 45, 35 and 30 µV from neonate to adult. The form fills it for the age and type you pick until you type your own.",
      onPage: "The height of the background on the page. Individual waves vary around it; blinks and discharges are drawn relative to it.",
      onTrends: "Moves the aEEG margins and total power.",
      names: ["bg:amplitude_uv"],
    },
    {
      id: "bg-amplitude-reference", name: "What amplitude means", where: "advanced",
      what: "Whether the amplitude you enter is the displayed bipolar peak-to-peak (the reader's measurement) or an underlying referential scale used by older cases.",
      options: [
        o("display", "Displayed peak-to-peak", "What a reader measures on the page."),
        o("referential", "Referential scale", "The older convention; the page will look lower than the number entered."),
      ],
      defaultText: "Displayed peak-to-peak (edition 2 and 3).",
      onPage: "With the displayed convention, the number you type is the number a learner measures.",
      names: ["bg:amplitude_reference"],
    },
    {
      id: "bg-slow", name: "Slow fraction", formLabel: "Slow fraction", where: "form",
      what: "How much slow (delta–theta) activity is mixed into the background. A mixing setting, not a measured percentage of power.",
      range: "0 to 1.",
      defaultText: "By age (0.80 neonate to 0.25 adult); the form fills it for the age you pick.",
      onPage: "Higher values give a slower, more disorganized background.",
      onTrends: "Raises delta power and lowers the alpha/delta ratio.",
      names: ["bg:slow_fraction"],
    },
    {
      id: "bg-reactivity", name: "Reactivity", formLabel: "Reactivity", where: "form", optionSet: "REACTIVITY",
      what: "Whether the background changes after stimulation.",
      options: [
        o("present", "Present", "A timed stimulation produces a visible background change (by default an increase in voltage and faster activity)."),
        o("absent", "Absent", "No change after stimulation; no spontaneous blinks; sleep architecture is absent unless set otherwise."),
        o("unknown", "Unknown / unclear (Expert mode)", "Drawn as no response and recorded as such."),
      ],
      defaultText: "Present, except absent for neonates under 34 weeks postmenstrual age and for coma patterns.",
      onPage: "Only visible where a stimulation event is placed.",
      names: ["bg:reactivity"],
    },
    {
      id: "bg-burst", name: "Burst length and interburst interval", formLabel: "Burst length s / Interburst interval s", where: "form",
      what: "For burst suppression: the typical burst duration and the typical suppression between bursts. Intervals vary around the value, as in real recordings.",
      range: "Seconds.",
      defaultText: "Form: 2 s bursts, 8 s interburst.",
      onPage: "Longer interburst intervals give longer flat stretches on each page.",
      onTrends: "The suppression ratio rises with the interburst share of each minute.",
      names: ["bg:burst_suppression"],
    },
    {
      id: "bg-burst-detail", name: "Burst suppression details", where: "advanced",
      what: "Fine control of burst suppression: interval variability, residual interburst voltage, the longest interval allowed, and epileptiform bursts (number of discharges per burst, fraction of highly epileptiform bursts, spacing and phases).",
      defaultText: "Set by the background type and, for neonates, by postmenstrual age.",
      onPage: "Variable, non-metronomic bursts with a low but not dead-flat interburst; epileptiform bursts carry sharp discharges inside the burst.",
      names: ["bg:burst_suppression"],
    },
    {
      id: "bg-ibi", name: "Interburst range and floor", where: "advanced",
      what: "The interburst interval as a low–high range in seconds (covering the central 99% of intervals, not hard limits) and the interburst voltage in µV.",
      range: "Floor 0 to 200 µV.",
      defaultText: "From the background type or the postmenstrual-age tables.",
      onPage: "Longer and flatter interburst periods.",
      onTrends: "Lower aEEG lower margin; higher suppression ratio.",
      names: ["bg:ibi_range_s", "bg:ibi_floor_uv"],
    },
    {
      id: "bg-pdr", name: "Posterior rhythm strength and field", where: "advanced",
      what: "How prominent the posterior dominant rhythm is (strength 0–8) and whether its field is focal occipital–parietal or broad.",
      options: [
        o("focal", "Focal", "Occipital–parietal maximum with an anterior–posterior gradient."),
        o("broad", "Broad", "The older, widespread field."),
      ],
      defaultText: "Strength 2.5 for all ages beyond the neonate; focal field.",
      onPage: "A clearer posterior rhythm that is best with eyes closed and just after a blink.",
      names: ["bg:pdr_gain", "bg:pdr_field"],
    },
    {
      id: "bg-gradient", name: "Anterior–posterior gradient", where: "advanced",
      what: "Whether faster, lower-voltage activity lies anteriorly and the posterior rhythm posteriorly.",
      options: [o("present", "Present", "Normal organization."), o("absent", "Absent", "Loss of the gradient, as in encephalopathy.")],
      defaultText: "Present.",
      onPage: "Absent gradient makes anterior and posterior chains look alike.",
      names: ["bg:ap_gradient"],
    },
    {
      id: "bg-asymmetry", name: "Hemispheric or regional asymmetry", where: "advanced",
      what: "Attenuation (percent) and/or slowing (Hz) of one hemisphere, applied across the whole side or graded with distance from the midline. Edition 3 also takes a region (for example left temporal, or a list of electrodes) to confine the attenuation and polymorphic delta to that region.",
      defaultText: "None. When set without a region, the whole hemisphere is affected.",
      onPage: "Lower voltage or slower activity on the affected side, or only in the chosen region's derivations, throughout the recording.",
      onTrends: "The asymmetry panels show a sustained deflection toward the affected side.",
      names: ["bg:asymmetry"],
    },
    {
      id: "bg-breach", name: "Breach effect", where: "advanced",
      what: "Higher voltage and sharper fast activity over a skull defect, centred on an electrode, with its own voltage and fast-activity gains and optional list of electrodes in the defect.",
      defaultText: "None. The defect covers the focus and its neighbours when set.",
      onPage: "Sharply contoured, higher-voltage activity over the defect that should not be mistaken for discharges.",
      names: ["bg:breach"],
    },
    {
      id: "bg-synchrony", name: "Burst synchrony", where: "advanced",
      what: "The fraction of bursts that occur at the same time on both hemispheres.",
      range: "0 to 1.",
      defaultText: "Age-appropriate.",
      onPage: "Lower values give asynchronous bursts, typical of the young preterm neonate.",
      names: ["bg:synchrony"],
    },
    {
      id: "bg-long-term", name: "Slow changes over hours", where: "advanced",
      what: "Background amplitude and interburst voltage that change over hours, set as time–value pairs; for recovery or deterioration over a long recording.",
      defaultText: "No change.",
      onPage: "Gradual change between early and late pages.",
      onTrends: "A sloping aEEG and suppression ratio.",
      names: ["bg:amplitude_gain_at_h", "bg:ibi_floor_at_h"],
    },
    {
      id: "bg-cape", name: "Cyclic alternating pattern of encephalopathy", where: "advanced",
      what: "Two alternating backgrounds (each phase at least 10 s, at least six cycles), with cycle period 20–240 s, depth, number of cycles, start time and optional slowing.",
      defaultText: "Off.",
      onPage: "Regular alternation between two background patterns.",
      onTrends: "A periodic ripple in the aEEG and total power.",
      names: ["bg:cape"],
    },
    {
      id: "bg-gain", name: "Electrode voltage variation limit", where: "advanced",
      what: "Caps how much higher any one electrode's voltage may be than the typical electrode, so a single electrode does not look like a mirror-image focus.",
      range: "1 to 10 times.",
      defaultText: "1.5.",
      onPage: "Even voltage across neighbouring derivations.",
      names: ["bg:channel_gain_max"],
    },
    {
      id: "bg-coma", name: "Coma pattern", where: "advanced",
      what: "An unreactive coma background.",
      options: [
        o("spindle", "Spindle coma", "Continuous N2-like spindles, vertex waves and K-complexes without sleep cycling."),
        o("alpha", "Alpha coma", "Diffuse, frontally predominant, monotonous alpha with no posterior dominant rhythm."),
      ],
      defaultText: "None. Reactivity becomes absent when set.",
      onPage: "Sleep-like or alpha activity that does not vary or react.",
      names: ["bg:coma_pattern"],
    },
    {
      id: "bg-multifocal", name: "Multifocal spikes", where: "advanced",
      what: "Independent spikes and sharp waves from many locations, as a rate per second over the whole head and a voltage.",
      range: "0 to 20 per second; up to 600 µV.",
      defaultText: "Off, except hypsarrhythmia (2 per second, 400 µV).",
      onPage: "Scattered discharges at shifting locations standing above the background.",
      names: ["bg:multifocal_spikes"],
    },
  ],
};

const sleep: GuideSection = {
  id: "sleep",
  title: "Sleep, wake and state",
  summary: "Falling asleep, sleep stages, arousals and the pediatric variants tied to state.",
  intro: [
    "Awake recordings alternate eyes-open and eyes-closed periods: the posterior rhythm attenuates with eyes open and is best just after a blink. When the patient falls asleep, stages cycle through N1, N2, N3 and REM with age-appropriate cycle lengths (about 55 minutes in infants, 75 in children, 90 in adolescents and adults, with more N3 early).",
    "Each stage owns its transients: vertex waves in N1 and N2, spindles and K-complexes in N2 (fewer in N3), high-voltage slow waves in N3, and in REM low-voltage mixed activity with rapid eye movements and loss of muscle. The posterior rhythm, blinks and muscle fade with sleep.",
  ],
  controls: [
    {
      id: "state-change", name: "State change", formLabel: "State change: At min / To", where: "form", optionSet: "STATE_TO",
      what: "A timed change of state.",
      options: [
        o("sleep", "Sleep", "Falls asleep: drowsiness, then cycling stages with their transients."),
        o("wake", "Wake", "Wakes: posterior rhythm, blinks and muscle return."),
        o("arousal", "Arousal", "A brief arousal from sleep."),
        o("rem", "REM", "REM sleep: low-voltage mixed activity, rapid eye movements, muscle atonia."),
      ],
      defaultText: "The recording starts awake (neonates follow their own sleep–wake cycle when it is on).",
      onPage: "Drowsiness and sleep transients appear after the change.",
      onTrends: "Sleep raises delta power and the aEEG, and spindles add a sigma band on the spectrogram.",
      names: ["event:state_change"],
    },
    {
      id: "staging", name: "Sleep staging", where: "advanced",
      what: "Whether sleep cycles through stages or holds one stage.",
      options: [
        o("cycling", "Cycling", "N1, N2, N3 and REM in age-appropriate cycles."),
        o("static", "Static", "Holds N2 throughout, for a page of spindles and K-complexes."),
      ],
      defaultText: "Cycling.",
      onPage: "Which stage a given page shows.",
      names: ["bg:sleep_staging"],
    },
    {
      id: "architecture", name: "Sleep architecture", where: "advanced",
      what: "Whether natural sleep features are present.",
      options: [
        o("normal", "Normal", "Stages and their transients."),
        o("absent", "Absent", "State changes still happen but without cycling, spindles, vertex waves, K-complexes, slow waves or REM (encephalopathy)."),
      ],
      defaultText: "Normal when reactive; absent when the background is unreactive.",
      onPage: "Absent architecture is a teaching sign of encephalopathy.",
      names: ["bg:sleep_architecture"],
    },
    {
      id: "spindles", name: "Spindle rate and frequency", where: "advanced",
      what: "Spindles per minute of N2 (N3 gets about a third) and their frequency.",
      range: "0 to 15 per minute; 10 to 16 Hz.",
      defaultText: "4 per minute, occurring irregularly.",
      onPage: "Central 11–16 Hz spindles, each at least half a second, at irregular intervals.",
      names: [],
    },
    {
      id: "variants-peds", name: "Pediatric state variants", where: "advanced",
      what: "Normal pediatric variants that appear only in their own state: hypnagogic/hypnopompic hypersynchrony (drowsiness), positive occipital sharp transients of sleep (sleep) and posterior slow waves of youth (awake). Each can be switched on with its own voltage and rate.",
      defaultText: "Off. When on: hypersynchrony at least 4.5 times the background (minimum 200 µV), POSTS 70 µV (140 µV on the 90 µV child default), posterior slow waves 1.3 times the background; 5–6 runs per minute in the permitting state.",
      onPage: "Runs of high-voltage rhythmic theta–delta in drowsiness, occipital positive transients in sleep, or posterior slow waves fused with the posterior rhythm awake.",
      names: ["bg:variants"],
    },
  ],
};

const neonatal: GuideSection = {
  id: "neonatal",
  title: "Neonatal recordings",
  summary: "Maturation, sleep–wake cycling, tracé alternant and neonatal graphoelements.",
  intro: [
    "For neonates, postmenstrual age drives discontinuity: interburst interval and its variability, burst length, interburst voltage and burst voltage follow published maturational tables, and no interval exceeds the longest acceptable interburst interval for that age (about 46 s at 26 weeks, 20 s at 31–33 weeks, 10 s at 34–36 weeks and 6 s at term).",
    "Use the neonatal age band with the reduced 9-electrode set and the neonatal montage for a typical NICU recording. Neonatal seizures are built with the focal seizure event (at least 10 seconds); shorter evolving runs are brief rhythmic discharges.",
  ],
  controls: [
    {
      id: "pma", name: "Postmenstrual age", where: "advanced",
      what: "Gestational plus postnatal age in weeks.",
      range: "23 to 48 weeks.",
      defaultText: "None: the neonatal preset (discontinuous, 60 µV) is used.",
      onPage: "Younger ages give longer, flatter, more asynchronous interburst periods and more delta brushes; term gives continuous or tracé alternant patterns.",
      onTrends: "The aEEG lower margin and bandwidth mature with age.",
      names: ["bg:pma_weeks"],
    },
    {
      id: "hours", name: "Hours of life", where: "advanced",
      what: "Postnatal age in hours, for first-day patterns and for labelling aEEG time axes.",
      range: "0 to 720 hours.",
      defaultText: "None.",
      onPage: "First-day state distribution; aEEG can show hours of life on its axis.",
      names: ["bg:hours_of_life"],
    },
    {
      id: "dysmature", name: "Dysmaturity", where: "advanced",
      what: "Draws patterns from a younger postmenstrual age than stated, for a dysmature record.",
      range: "23 to 48 weeks.",
      defaultText: "None.",
      onPage: "Graphoelements and discontinuity belonging to the younger age, such as persistent delta brushes.",
      names: ["bg:dysmature_pma_weeks"],
    },
    {
      id: "state-cycle", name: "Term sleep–wake cycle", where: "advanced",
      what: "Cycles the term neonate through wakefulness, active sleep and quiet sleep.",
      options: [o("term", "Term cycle", "Quiet sleep shows tracé alternant; active sleep and wake are continuous; blinks about 2/min, awake only.")],
      defaultText: "Off.",
      onPage: "Pages differ by state: tracé alternant in quiet sleep, continuous mixed activity in active sleep.",
      onTrends: "Cyclic widening of the aEEG band.",
      names: ["bg:state_cycle"],
    },
    {
      id: "brushes", name: "Delta brushes", where: "advanced",
      what: "Delta waves with superimposed fast activity, scheduled by postmenstrual age.",
      options: [
        o("riding", "Discrete brushes", "Individual delta waves with riding fast activity (the neonatal default)."),
        o("on", "Older blended model", "Kept for older cases."),
        o("off", "Off", "No delta brushes."),
      ],
      defaultText: "Discrete brushes for neonates; off for other ages.",
      onPage: "Brushes most prominent at 28–34 weeks, fading toward term.",
      names: ["bg:delta_brushes"],
    },
    {
      id: "graphoelements", name: "Neonatal graphoelements", where: "advanced",
      what: "Rate, voltage and on/off for each developmental transient: occipital delta, temporal theta, temporal alpha, sharp theta on the occipitals of prematurity, frontal sharp transients (encoches frontales), anterior slow dysrhythmia, midline theta, delta brushes and sharp transients.",
      defaultText: "Set by postmenstrual age.",
      onPage: "The transients expected for the stated age.",
      names: ["bg:graphoelements"],
    },
  ],
};

const focal: GuideSection = {
  id: "focal",
  title: "Focal seizures",
  summary: "Onset, evolution, spread, postictal change, clusters and status epilepticus.",
  intro: [
    "A focal seizure is a run that evolves in frequency, voltage and location. The onset pattern depends on the region: mesial temporal seizures start with rhythmic theta, neocortical temporal seizures with low-voltage fast activity, frontal seizures with an electrodecrement carrying fast activity, and central, parietal and occipital seizures with rhythmic spikes. The run then slows while its voltage builds and ends with clonic bursting.",
    "In edition 3 every seizure is kept visibly above the background (at least 1.5 times it at onset and twice it once established), and the answer key describes only what is visible on the page.",
  ],
  controls: [
    {
      id: "sz-when", name: "Onset and duration", formLabel: "Onset min / Duration s", where: "form",
      what: "When the seizure starts and how long it lasts.",
      range: "Onset within the recording; duration in seconds.",
      defaultText: "Form: middle of the recording, 110 s (90 s if left out in Expert mode).",
      onPage: "The ictal run on pages covering that time.",
      onTrends: "A rise in rhythmicity and seizure probability, a raised aEEG lower margin and an arch-shaped spectrogram change.",
      names: ["event:seizure"],
    },
    {
      id: "sz-region", name: "Onset region", formLabel: "Onset region", where: "form", optionSet: "REGIONS",
      what: "Where the seizure begins.",
      options: REGION_OPTIONS,
      defaultText: "Left temporal.",
      onPage: "Phase reversal or amplitude maximum at the onset electrodes.",
      onTrends: "The ipsilateral spectrogram and asymmetry panels change first.",
      names: ["field:onset_region"],
    },
    {
      id: "sz-spread", name: "Spread", formLabel: "Spread", where: "form", optionSet: "SPREADS",
      what: "Where the seizure spreads after onset.",
      options: [
        o("none", "None", "Stays at its onset region."),
        o("hemispheric", "Hemispheric", "Spreads across the onset hemisphere."),
        o("generalized", "Generalized", "Spreads to both hemispheres (bilateral tonic-clonic evolution)."),
        o("contralateral", "Contralateral", "Spreads to the homologous region on the other side."),
      ],
      defaultText: "None.",
      onPage: "Later pages of the run involve more channels.",
      onTrends: "Both hemispheres' trends change when it spreads.",
      names: ["field:spread"],
    },
    {
      id: "sz-evolution", name: "Evolution of frequency and voltage", formLabel: "Start Hz / End Hz / Start µV / End µV", where: "form",
      what: "Frequency and voltage at the start and end of the run.",
      range: "0.2 to 30 Hz; voltage in µV.",
      defaultText: "4 Hz to 1.5 Hz, 60 to 150 µV.",
      onPage: "A run that slows and builds in voltage; the displayed voltage is never below the visibility floor described above.",
      onTrends: "A downward-sweeping band on the spectrogram.",
      names: ["field:evolution"],
    },
    {
      id: "sz-onset-pattern", name: "Onset pattern", formLabel: "Onset pattern", where: "form", optionSet: "ONSET_PATTERNS",
      what: "How the seizure starts.",
      options: [
        o("", "Standard (blank)", "Uses the region-appropriate onset in edition 3."),
        o("auto", "By region", "Chooses from the onset region, as described above."),
        o("lvfa", "Low-voltage fast", "Low-voltage fast activity at onset."),
        o("rhythmic_theta", "Rhythmic theta (mesial temporal)", "5–9 Hz theta building from the first second, no fast onset."),
        o("electrodecrement", "Electrodecrement (frontal)", "Regional attenuation carrying low-voltage fast activity."),
        o("rhythmic_spikes", "Rhythmic spikes", "Rhythmic alpha–beta onset with a sharp transient on every cycle."),
      ],
      defaultText: "By region.",
      onPage: "The first seconds of the ictal run.",
      names: ["field:onset_pattern"],
    },
    {
      id: "sz-postictal", name: "Postictal attenuation", formLabel: "Postictal attenuation s", where: "form",
      what: "Seconds of regional voltage depression and slowing after the seizure.",
      range: "0 seconds or more.",
      defaultText: "Form: 60 s. If left out in Expert mode: 20 s.",
      onPage: "Lower-voltage, slower activity over the seizure region after the run.",
      onTrends: "A brief dip in the aEEG and total power, and a rise in suppression.",
      names: ["field:postictal_attenuation_s"],
    },
    {
      id: "sz-muscle", name: "Muscle and clinical correlate", where: "advanced",
      what: "How much scalp muscle artifact the seizure carries, and the clinical sign recorded with it.",
      options: [
        o("none", "Muscle: none", "Electrographic only, or a paralysed patient."),
        o("modest", "Muscle: modest", "Some myogenic artifact."),
        o("clinical", "Muscle: clinical", "Marked muscle artifact."),
        o("focal_clonic", "Correlate: focal clonic", "Also brings rhythmic muscle artifact."),
        o("focal_tonic", "Correlate: focal tonic", "Also brings muscle artifact."),
        o("generalized_tonic_clonic", "Correlate: generalized tonic-clonic", "Also brings muscle artifact."),
        o("subtle", "Correlate: subtle / autonomic / behavioural arrest / unknown / none", "Recorded in the answer key only; does not change the EEG."),
      ],
      defaultText: "No muscle unless the seizure spreads (then modest) or a motor correlate is chosen.",
      onPage: "Muscle artifact obscuring the ictal run in some channels.",
      names: [],
    },
    {
      id: "sz-shape", name: "Waveform and visibility", where: "advanced",
      what: "The waveform family of the run (rhythmic ictal activity, spike-and-wave, or rhythmic delta) and whether the visibility floor applies.",
      options: [
        o("relative", "Kept visible", "At least 1.5 times the background at onset, twice once established."),
        o("absolute", "Exact voltages", "Uses the voltages entered even if they are close to the background."),
      ],
      defaultText: "Rhythmic ictal activity; kept visible.",
      onPage: "Spike-and-wave keeps the spike narrow as the repetition rate slows.",
      names: [],
    },
    {
      id: "sz-cluster", name: "Seizure cluster", formLabel: "Start min / End min / Interval min / First run s / Last run s", where: "form",
      what: "Repeated seizures from one region between two times, at a mean interval, with the first and last run lengths (runs in between are graded, so a cluster can escalate or settle after treatment). Onsets vary around the interval.",
      defaultText: "Form: from a quarter to four-fifths of the recording, every 12 minutes, 60 s runs, right central.",
      onPage: "Each seizure resembles the others but is not identical.",
      onTrends: "A repeating pattern of aEEG rises and seizure-probability peaks.",
      names: ["event:seizure_cluster"],
    },
    {
      id: "sz-status", name: "Status epilepticus", where: "advanced",
      what: "Continuous or recurrent seizure activity from an onset time for a number of minutes.",
      defaultText: "Set per case.",
      onPage: "Ictal activity on every page of the period.",
      onTrends: "A sustained raised aEEG and seizure probability.",
      names: ["event:status_epilepticus"],
    },
  ],
};

const generalized: GuideSection = {
  id: "generalized",
  title: "Generalized seizures, spasms and interictal patterns",
  summary: "Seizure types by ILAE classification, generalized discharges, spasms and neonatal brief rhythmic discharges.",
  intro: [
    "Generalized seizures are built by type. Voltages are measured on the largest longitudinal bipolar derivation and run several times the background, as in reference figures. \"Provoked by\" is recorded with the event but does not change the signal: place the matching activation yourself if you want it seen.",
  ],
  controls: [
    {
      id: "gen-type", name: "Seizure type", formLabel: "Seizure type", where: "form", optionSet: "GENERALIZED_SEIZURE_TYPES",
      what: "The generalized seizure to draw.",
      options: [
        o("typical_absence", "Typical absence", "3 Hz generalized spike-and-wave, abrupt on and off; 10 s, 300 µV."),
        o("atypical_absence", "Atypical absence", "About 2 Hz slow spike-and-wave with gradual onset and offset; 15 s, 250 µV."),
        o("myoclonic", "Myoclonic", "A generalized polyspike-and-wave complex (0.3–0.8 s) with a brief muscle jerk."),
        o("myoclonic_atonic", "Myoclonic-atonic", "Polyspike-wave jerk followed by about 0.8 s loss of tone."),
        o("myoclonic_tonic", "Myoclonic-tonic", "Polyspike-wave jerk followed by about 2 s of tonic stiffening."),
        o("tonic", "Tonic", "Diffuse electrodecrement then paroxysmal fast activity (about 20 Hz slowing to 12 Hz) with tonic muscle; 8 s, usually from sleep."),
        o("atonic", "Atonic", "A brief high-voltage slow wave or spike-wave with loss of tone; about 1.2 s."),
        o("gtc", "Generalized tonic-clonic", "Tonic phase (about 12 s) of fast activity, clonic phase (about 35 s) of polyspike bursts, then 60 s of postictal suppression, with heavy muscle artifact."),
        o("eyelid_myoclonia", "Eyelid myoclonia", "Brief 4 Hz polyspike-wave with eyelid flutter artifact after eye closure."),
        o("photoparoxysmal", "Photoparoxysmal response", "Generalized 3–4 Hz spike-wave during a flash train (5 s at 18 Hz), not locked to the flashes, with photic driving; may or may not outlast the train."),
      ],
      defaultText: "Typical absence.",
      onPage: "Bilateral synchronous discharges, frontally predominant.",
      onTrends: "Brief seizures barely move hourly trends; a tonic-clonic seizure raises the aEEG and is followed by suppression.",
      names: ["event:generalized_seizure"],
    },
    {
      id: "gen-provocation", name: "Provoked by", formLabel: "Provoked by", where: "form", optionSet: "PROVOCATIONS",
      what: "The activation recorded as provoking the seizure. It does not change the EEG.",
      options: [
        o("none", "None", "No provocation recorded."),
        o("hyperventilation", "Hyperventilation", "Typical for absence."),
        o("photic", "Photic stimulation", "Typical for a photoparoxysmal response."),
        o("eye_closure", "Eye closure", "Typical for eyelid myoclonia."),
        o("sleep", "Sleep", "Typical for tonic seizures."),
        o("awakening", "Awakening", "Typical for myoclonic seizures and spasms."),
      ],
      defaultText: "None (some types record their typical provocation automatically).",
      onPage: "No change. Add a hyperventilation build-up variant or a state change if you want the activation seen.",
      names: [],
    },
    {
      id: "gen-duration", name: "Duration and number of jerks", formLabel: "Duration s / Jerks", where: "form",
      what: "Seconds of the run for absence, tonic and atonic seizures; number of jerks for the myoclonic types. Other types use their own typical phase lengths.",
      defaultText: "Form: 10 s and 1 jerk.",
      onPage: "Longer runs; a train of jerks about every 3 seconds.",
      names: [],
    },
    {
      id: "gen-discharges", name: "Generalized interictal discharges", where: "advanced",
      what: "Generalized discharges throughout the recording or a period of it.",
      options: [
        o("spike_wave", "Spike-and-wave", "3.5 Hz bursts of about 1.2 s, 30 per hour."),
        o("polyspike_wave", "Polyspike-and-wave", "4.5 Hz bursts of about 1.5 s, 20 per hour."),
        o("slow_spike_wave", "Slow spike-and-wave", "2 Hz runs of about 6 s, 40 per hour."),
        o("gpfa", "Generalized paroxysmal fast activity", "About 20 Hz, 150 µV bursts of about 1.5 s in NREM sleep, fewer in N3."),
        o("eses", "Electrical status epilepticus in sleep", "Near-continuous 2 Hz spike-wave covering 90% of N2/N3, 10% of wakefulness."),
      ],
      defaultText: "Spike-and-wave.",
      onPage: "Bilateral bursts at the stated rate; in ESES, sleep pages are dominated by spike-wave.",
      names: ["event:generalized_discharges"],
    },
    {
      id: "spasm", name: "Epileptic spasms", where: "advanced",
      what: "A single spasm or a cluster: a generalized high-voltage slow wave with a brief muscle burst, then a diffuse electrodecrement carrying low-voltage fast activity. Clusters set the mean interval (2–300 s) and number of spasms; a spasm may be asymmetric.",
      defaultText: "0.8 s slow wave, 3.5 s decrement removing about 85% of the background, with low-voltage fast activity riding it.",
      onPage: "Repeated slow wave–decrement complexes, typically on waking, often from a hypsarrhythmic background.",
      names: ["event:spasm", "event:spasm_cluster"],
    },
    {
      id: "tonic-seizure", name: "Tonic seizure (older model)", where: "advanced",
      what: "An electrodecrement followed by generalized paroxysmal fast activity building in voltage, with tonic muscle. The generalized seizure type \"Tonic\" is the current way to build this.",
      defaultText: "Set per case.",
      onPage: "Decrement then fast activity with muscle artifact.",
      names: ["event:tonic_seizure"],
    },
    {
      id: "brd", name: "Brief rhythmic discharges (neonatal)", where: "advanced",
      what: "Evolving rhythmic activity lasting under 10 seconds, below the ACNS neonatal seizure minimum.",
      defaultText: "Set per case.",
      onPage: "Short rhythmic runs that do not meet seizure duration.",
      names: ["event:brd"],
    },
  ],
};

const acns: GuideSection = {
  id: "acns",
  title: "Rhythmic and periodic patterns (ACNS 2021)",
  summary: "LPDs, GPDs, BIPDs, LRDA, GRDA, BIRDs, extreme delta brush, triphasic waves and SIRPIDs, with modifiers.",
  intro: [
    "These follow the ACNS 2021 critical care EEG terminology. A rhythmic or periodic pattern is not a seizure: unless you mark it evolving, it has no frequency or voltage evolution and no postictal change, so the aEEG and seizure probability should stay flat through it. That contrast is often the teaching point.",
    "Periodic discharges keep a physiological width whatever their repetition rate, and their frequency stays inside the ACNS band you are teaching.",
  ],
  controls: [
    {
      id: "rpp-pattern", name: "Pattern", formLabel: "Pattern", where: "form", optionSet: "ACNS_PATTERNS",
      what: "The main term.",
      options: [
        o("LPDs", "LPDs", "Lateralized periodic discharges; default left hemisphere."),
        o("GPDs", "GPDs", "Generalized periodic discharges."),
        o("BIPDs", "BIPDs", "Bilateral independent periodic discharges."),
        o("LRDA", "LRDA", "Lateralized rhythmic delta activity; default left temporal."),
        o("GRDA", "GRDA", "Generalized rhythmic delta activity, frontally predominant."),
        o("BIRDs", "BIRDs", "Brief potentially ictal rhythmic discharges: focal runs above 4 Hz lasting 0.5–10 s (default 5 Hz, 3 s runs, 70 µV)."),
        o("EDB", "Extreme delta brush", "Continuous frontally predominant 1–3 Hz delta with 20–30 Hz fast activity on each wave (default 1.5 Hz, 150 µV, fast activity 24 Hz)."),
        o("triphasic", "Triphasic GPDs", "1.5–2.5 Hz GPDs with triphasic morphology and an anterior–posterior lag (default 1.8 Hz, 110 µV)."),
        o("SIRPIDs", "SIRPIDs", "Stimulus-induced rhythmic, periodic or ictal-appearing discharges: runs start 0.5–3 s after each stimulation and are absent otherwise. Place stimulation events."),
      ],
      defaultText: "LPDs in the form.",
      onPage: "The chosen pattern for its duration at its region.",
      onTrends: "Rhythmicity rises modestly; aEEG and seizure probability stay flat unless the pattern evolves.",
      names: ["event:rhythmic_pattern"],
    },
    {
      id: "rpp-where", name: "Region, onset and duration", formLabel: "Region / Onset min / Duration min", where: "form",
      what: "Where the pattern is and when. Uses the same regions as seizures.",
      defaultText: "Form: the pattern's usual region, from the middle of the recording for 20 minutes.",
      onPage: "Pattern present at that region during that period.",
      names: [],
    },
    {
      id: "rpp-freq", name: "Frequency and amplitude", formLabel: "Frequency Hz / Amplitude µV", where: "form",
      what: "Repetition rate of the discharges or rhythm, and its voltage.",
      range: "0.2 to 30 Hz.",
      defaultText: "Form: 1.5 Hz, 80 µV (60 µV if left out in Expert mode).",
      onPage: "Discharges at that rate; the rate wanders slightly run to run but stays in its ACNS band.",
      names: [],
    },
    {
      id: "rpp-plus", name: "Plus modifier", formLabel: "Plus modifier", where: "form", optionSet: "ACNS_PLUS",
      what: "Additional features that make the pattern more ictal-appearing.",
      options: [
        o("", "None", "No plus modifier."),
        o("+F", "+F", "Superimposed fast activity (default 14 Hz on PDs, 13 Hz on RDA)."),
        o("+R", "+R", "Superimposed rhythmic activity."),
        o("+S", "+S", "Superimposed sharp waves or spikes; applies to rhythmic delta. On PDs it is drawn as spiky sharpness."),
        o("+FR", "+FR", "Fast and rhythmic."),
        o("+FS", "+FS", "Fast and sharp."),
      ],
      defaultText: "None.",
      onPage: "Fast, rhythmic or sharp components riding on each discharge.",
      names: [],
    },
    {
      id: "rpp-prevalence", name: "Prevalence", formLabel: "Prevalence", where: "form", optionSet: "ACNS_PREVALENCE",
      what: "The share of the period occupied by the pattern (ACNS main modifier 1).",
      options: [
        o("", "Not set", "Runs follow the duration setting."),
        o("continuous", "Continuous", "90% or more."),
        o("abundant", "Abundant", "50–89%."),
        o("frequent", "Frequent", "10–49%."),
        o("occasional", "Occasional", "1–9%."),
        o("rare", "Rare", "Under 1%."),
      ],
      defaultText: "Not set.",
      onPage: "How many pages in the period show the pattern.",
      names: [],
    },
    {
      id: "rpp-evolving", name: "Evolving", formLabel: "Evolving", where: "form",
      what: "Marks the pattern as evolving in frequency, location or morphology (ACNS criterion for an electrographic seizure when it lasts long enough).",
      defaultText: "Off.",
      onPage: "The pattern changes over the run instead of staying stable.",
      onTrends: "The trends begin to look seizure-like.",
      names: [],
    },
    {
      id: "rpp-sharpness", name: "Sharpness", where: "advanced",
      what: "Sharpness of the dominant phase.",
      options: [
        o("spiky", "Spiky", "Under 70 ms at the base."),
        o("sharp", "Sharp", "70–200 ms."),
        o("sharply_contoured", "Sharply contoured", "Pointed but over 200 ms."),
        o("blunt", "Blunt", "Rounded."),
      ],
      defaultText: "The pattern's usual morphology.",
      onPage: "Narrower or broader discharges at the same repetition rate.",
      names: [],
    },
    {
      id: "rpp-polarity", name: "Polarity", where: "advanced",
      what: "Sign of the discharge's dominant phase at its source, judged on a referential montage (ACNS minor modifier). Periodic discharges only.",
      options: [
        o("surface_negative", "Surface negative", "Negative at the source: upward on the page in referential montages and maximal at the source."),
        o("surface_positive", "Surface positive", "Positive at the source: downward in referential montages."),
        o("dipole", "Dipole (tangential)", "Negative at the source with a positive pole at a distinct electrode: frontal for temporal, central or posterior sources, occipital for frontal sources, Pz for generalized."),
      ],
      defaultText: "Surface negative. Triphasic waves keep their positive second phase.",
      onPage: "Which way the discharge points and where its opposite pole appears.",
      names: [],
    },
    {
      id: "rpp-lag", name: "Lag and predominance", where: "advanced",
      what: "Anterior–posterior or posterior–anterior lag across the chain (with the lag in milliseconds), and whether a generalized pattern is frontally or occipitally predominant.",
      options: [
        o("none", "No lag", "Discharges simultaneous across the chain."),
        o("anterior_posterior", "Anterior–posterior", "Front leads back (default for triphasic waves, 120 ms)."),
        o("posterior_anterior", "Posterior–anterior", "Back leads front."),
        o("frontal", "Frontal predominance", "Default for generalized patterns."),
        o("occipital", "Occipital predominance", "For occipital intermittent rhythmic delta-like patterns."),
      ],
      defaultText: "No lag (triphasic: anterior–posterior); frontal predominance.",
      onPage: "A visible time offset of each discharge from front to back.",
      names: [],
    },
    {
      id: "rpp-more", name: "Duration category, stimulus induction and run control", where: "advanced",
      what: "ACNS duration category (very long, long, intermediate, brief, very brief), stimulus-induced runs, the frequency of +F fast activity, minimum cycles per run, voltage waxing and waning, and run-to-run rate variation.",
      defaultText: "The pattern's usual settings; stimulus-induced for SIRPIDs.",
      onPage: "Run lengths landing in the chosen category; runs tied to stimulation.",
      names: [],
    },
  ],
};

const interictal: GuideSection = {
  id: "interictal",
  title: "Interictal discharges",
  summary: "Sporadic focal spikes, sharp waves and polyspikes, and their sleep activation.",
  intro: [
    "Sporadic discharges come from one focus (or several) at a rate you set, each negative at the focus with a physiological field, so they phase-reverse in bipolar chains. Each discharge is counted in the answer key with its ACNS prevalence category.",
  ],
  controls: [
    {
      id: "ied-focus", name: "Focus", formLabel: "Focus", where: "form", optionSet: "DISCHARGE_FOCI",
      what: "The electrode of maximal negativity.",
      options: ["Fp1", "Fp2", "F7", "F3", "Fz", "F4", "F8", "T3", "C3", "Cz", "C4", "T4", "T5", "P3", "Pz", "P4", "T6", "O1", "O2"]
        .map((e) => o(e, e, "10–20 electrode.")),
      defaultText: "T3. Expert mode also offers a generalized frontocentral field for myoclonic epilepsies, and several foci firing independently or together.",
      onPage: "Phase reversal at the focus in longitudinal bipolar; maximum at the focus referentially.",
      names: ["event:sporadic_discharges"],
    },
    {
      id: "ied-rate", name: "Rate", formLabel: "Per hour (awake)", where: "form",
      what: "Discharges per hour while awake.",
      range: "0 to 3600 per hour.",
      defaultText: "60 per hour.",
      onPage: "About one per minute at the default; at 600 per hour most pages show several.",
      names: [],
    },
    {
      id: "ied-morph", name: "Morphology", formLabel: "Morphology", where: "form", optionSet: "DISCHARGE_MORPHOLOGIES",
      what: "The discharge shape.",
      options: [
        o("spike", "Spike", "Under 70 ms."),
        o("sharp_wave", "Sharp wave", "70–200 ms."),
        o("polyspike", "Polyspike", "Three to eight spikes (Expert mode sets the number) that return toward baseline between spikes."),
      ],
      defaultText: "Spike, with an after-going slow wave.",
      onPage: "The discharge standing out from the background; default voltage 80 µV (160 µV on the 90 µV child default background).",
      names: [],
    },
    {
      id: "ied-slow", name: "After-going slow wave", formLabel: "After-going slow wave", where: "form",
      what: "Whether each discharge is followed by a slow wave.",
      defaultText: "On.",
      onPage: "A slow wave following each spike or sharp wave.",
      names: [],
    },
    {
      id: "ied-sleep", name: "Sleep activation", formLabel: "Sleep activation ×", where: "form",
      what: "How much the rate rises in non-REM sleep, as a multiple of the waking rate. REM keeps about a tenth of the extra rate; Expert mode can set a rate for each stage directly.",
      range: "1 (no activation) to 100.",
      defaultText: "1 (no sleep activation).",
      onPage: "More discharges on N2 and N3 pages than awake.",
      names: [],
    },
  ],
};

const stimulation: GuideSection = {
  id: "stimulation",
  title: "Stimulation and reactivity",
  summary: "Timed stimuli, the background response, and stimulus-induced patterns.",
  intro: [
    "A stimulation event marks a stimulus at a time. Whether the EEG responds depends on the background's reactivity. SIRPIDs and other stimulus-induced patterns appear only after stimulation events.",
  ],
  controls: [
    {
      id: "stim", name: "Stimulus", formLabel: "Stimulus", where: "form", optionSet: "STIMULI",
      what: "The type of stimulus, as ACNS asks you to document.",
      options: [
        o("auditory", "Auditory", "Voice or clap."),
        o("light_tactile", "Light touch", "Light tactile stimulation."),
        o("patient_care", "Patient care", "Nursing care, repositioning."),
        o("noxious", "Noxious", "Painful stimulation in general."),
        o("suction", "Suction", "Airway suction."),
        o("sternal_rub", "Sternal rub", "Sternal rub."),
        o("nailbed_pressure", "Nail-bed pressure", "Nail-bed pressure."),
        o("nostril_tickle", "Nostril tickle", "Nasal tickle."),
        o("trapezius_squeeze", "Trapezius squeeze", "Trapezius squeeze."),
        o("other", "Other", "Any other stimulus."),
      ],
      defaultText: "Noxious in the form.",
      onPage: "A stimulus marker and, if reactive, a background change lasting about 6 seconds.",
      onTrends: "A brief blip if the background responds.",
      names: ["event:stimulation"],
    },
    {
      id: "stim-response", name: "Response", where: "advanced",
      what: "The background's response to the stimulus.",
      options: [
        o("increase", "Increase", "Higher voltage and faster activity."),
        o("attenuation", "Attenuation", "Lower voltage."),
        o("paradoxical", "Paradoxical", "Slowing or higher-voltage delta."),
        o("none", "None", "No change."),
      ],
      defaultText: "Increase when the background is reactive, otherwise none.",
      onPage: "The change after each stimulus.",
      names: [],
    },
  ],
};

const sedation: GuideSection = {
  id: "sedation",
  title: "Sedation and the clinical course",
  summary: "Sedative agents, burst suppression targets, neuromuscular blockade, regional attenuation and temperature.",
  intro: [
    "Drug effects replace the awake background rather than riding on top of it. Deep sedation with a hypnotic removes the posterior rhythm, blinks and eye movements and reduces muscle. Settings are authored teaching effects, not a conversion from dose or concentration.",
  ],
  controls: [
    {
      id: "sed-change", name: "Sedation change", formLabel: "At min / Direction / Agent / Target SR % / Ramp min", where: "form",
      what: "A change in sedation at a time: increase or decrease, the agent, the suppression ratio it should reach, extra beta activity, and how many minutes it takes.",
      range: "Target suppression ratio 0–100%; ramp in minutes.",
      defaultText: "Form: increase of midazolam to 60% suppression over 10 minutes, with beta. A decrease with no target returns toward no suppression.",
      onPage: "Progressive slowing and, at high targets, burst suppression with a low but not flat interburst.",
      onTrends: "The suppression ratio climbs to the target over the ramp; the aEEG lower margin falls.",
      names: ["event:sedation_change"],
    },
    {
      id: "sed-agent", name: "Agent", formLabel: "Agent", where: "form", optionSet: "SEDATION_AGENTS",
      what: "The drug, which sets the EEG signature.",
      options: [
        o("propofol", "Propofol", "Frontal alpha appears as occipital alpha is lost, with more delta; burst suppression at high targets."),
        o("midazolam", "Midazolam", "Diffuse waxing and waning beta; in neonates, clearly lower voltage (to about half) with more theta and damped sleep-wake cycling."),
        o("pentobarbital", "Pentobarbital", "13–16 Hz barbiturate fast activity, then burst suppression with genuine bursts."),
        o("dexmedetomidine", "Dexmedetomidine", "Sleep-like slow background with frontal 9–15 Hz spindles lasting 1–2 s at irregular intervals."),
        o("ketamine", "Ketamine", "More theta, and alternating slow-delta and 25–32 Hz gamma epochs."),
        o("remifentanil", "Remifentanil", "Little EEG change; patients remain awake."),
      ],
      defaultText: "Midazolam.",
      onPage: "The agent's signature appears as sedation deepens.",
      onTrends: "Beta or alpha bands on the spectrogram; suppression for propofol and pentobarbital.",
      names: [],
    },
    {
      id: "sed-direction", name: "Direction", formLabel: "Direction", where: "form", optionSet: "SEDATION_DIRECTION",
      what: "Whether sedation is increased or weaned.",
      options: [
        o("increase", "Increase", "Deeper sedation from this time."),
        o("decrease", "Decrease", "Lighter sedation from this time."),
      ],
      defaultText: "Increase.",
      onPage: "Deepening or lightening over the ramp.",
      names: [],
    },
    {
      id: "sed-level", name: "Steady sedation level", where: "advanced",
      what: "Sedation present for the whole recording: an agent and a level from 0 to 1. At 0.7 and above, hypnotics produce unconsciousness.",
      range: "0 to 1.",
      defaultText: "None.",
      onPage: "The agent's signature throughout, instead of a timed change.",
      names: [],
    },
    {
      id: "nmb", name: "Neuromuscular blockade", where: "advanced",
      what: "Complete paralysis. Removes scalp muscle artifact only; cerebral activity and device artifacts are unchanged.",
      defaultText: "Off.",
      onPage: "No muscle artifact, even during seizures.",
      names: [],
    },
    {
      id: "attenuation", name: "Regional attenuation", formLabel: "At min / Duration min / Side / Depth % / Delta depth % / Ramp min", where: "form",
      what: "A loss of voltage over one or both hemispheres for a period, abrupt or gradual. Setting delta depth lower than overall depth makes the loss frequency-selective, as in ischemia, which takes fast activity first and spares delta.",
      range: "Depth 0–100%; ramp 0 (abrupt) or minutes (gradual).",
      defaultText: "Form: left side, 8 minutes, 55% depth, 15% delta depth, abrupt.",
      onPage: "Lower voltage and loss of faster frequencies on the affected side.",
      onTrends: "Alpha/delta and theta/delta ratios fall on that side and the asymmetry panels deflect. A uniform loss at equal depths leaves the ratios flat.",
      names: ["event:attenuation_transient"],
    },
    {
      id: "attenuation-side", name: "Attenuation side", formLabel: "Side", where: "form", optionSet: "ATTENUATION_SIDE",
      what: "Which hemisphere loses voltage.",
      options: [o("left", "Left", "Left hemisphere."), o("right", "Right", "Right hemisphere."), o("both", "Both", "Both hemispheres.")],
      defaultText: "Left in the form.",
      onPage: "The affected side's channels.",
      names: [],
    },
    {
      id: "temperature", name: "Temperature change", where: "advanced",
      what: "A change in body temperature over minutes, for therapeutic hypothermia and rewarming.",
      defaultText: "36.5 °C to 36.5 °C over 60 minutes (no change) until set.",
      onPage: "Cooling slows and lowers the background; rewarming reverses it.",
      onTrends: "A gradual shift in total power and spectral content.",
      names: ["event:temperature_change"],
    },
  ],
};

const variants: GuideSection = {
  id: "variants",
  title: "Normal variants",
  summary: "Benign patterns that are easily over-read.",
  intro: [
    "Each normal variant appears only in its teaching context (for example wickets in drowsiness), placed at a time and for a duration you choose. Voltages are measured in the derivation where the variant is best seen.",
  ],
  controls: [
    {
      id: "variant-kind", name: "Normal variant", where: "advanced",
      what: "The variant to add, placed like an artifact at a time and duration.",
      options: [
        o("mu", "Mu rhythm", "Arch-shaped 10 Hz central rhythm, about 1.5 times the background; blocks with movement."),
        o("lambda", "Lambda waves", "Occipital positive sharp transients with visual scanning."),
        o("wicket", "Wicket waves", "8 Hz arciform temporal bursts in drowsiness."),
        o("fourteen_and_six", "14 and 6 Hz positive bursts", "Posterior temporal positive bursts in light sleep, about 2.5 times the background."),
        o("rmtd", "Rhythmic mid-temporal theta of drowsiness", "5–6 Hz notched temporal theta."),
        o("sreda", "SREDA", "Subclinical rhythmic electrographic discharge of adults: about twice the background, in adult teaching cases."),
        o("frontal_arousal_rhythm", "Frontal arousal rhythm", "About 8 Hz frontal rhythm on arousal from sleep."),
        o("photic_driving", "Photic driving", "Occipital response time-locked to the flash rate."),
        o("hyperventilation_buildup", "Hyperventilation build-up", "High-voltage 3 Hz frontal delta during hyperventilation."),
      ],
      defaultText: "Set per case.",
      onPage: "The variant in its expected state and location.",
      names: ["event:normal_variant"],
    },
  ],
};

const artifacts: GuideSection = {
  id: "artifacts",
  title: "Artifacts",
  summary: "Physiological and environmental artifacts, and baseline blinks and ECG.",
  intro: [
    "Artifacts are added to the recorded voltages, so they can also move the trends and illustrate false detections. Blinks are drawn from reference recordings: a fast rise and slightly slower fall, maximal at Fp1/Fp2, varying blink to blink; they stop in sleep, in unresponsive patients and under deep sedation.",
  ],
  controls: [
    {
      id: "artifact-kind", name: "Artifact type", formLabel: "Kind", where: "form", optionSet: "ARTIFACT_KINDS",
      what: "The artifact to add at a time and duration.",
      options: [
        o("eye_blink", "Eye blinks", "Bifrontal deflections maximal at Fp1/Fp2."),
        o("lateral_eye", "Lateral eye movements", "Opposite-polarity deflections at F7 and F8."),
        o("slow_roving_eye", "Slow roving eye movements", "Slow lateral eye movements of drowsiness."),
        o("rem_eye_movements", "REM eye movements", "Rapid conjugate eye movements."),
        o("emg_chewing", "Chewing", "Irregular bursts of temporal muscle with a glossokinetic component."),
        o("glossokinetic", "Glossokinetic", "Slow frontal–temporal potentials from tongue movement."),
        o("movement", "Movement", "Large irregular deflections across many channels."),
        o("patting", "Patting", "Rhythmic bouts of patting at realistic voltage."),
        o("chest_pt", "Chest physiotherapy", "Rhythmic artifact from chest percussion."),
        o("ventilator", "Ventilator", "Slow artifact time-locked to the ventilator cycle."),
        o("ecmo_pump", "ECMO pump", "Rhythmic pump artifact."),
        o("electrode_pop", "Electrode pop", "Abrupt single-electrode deflection with slow decay."),
        o("sixty_hz", "60 Hz interference", "Mains interference; the page's notch filter is turned off automatically so it can be seen."),
        o("ecg", "ECG", "QRS-locked spikes, most visible in referential and ear montages."),
        o("pulse", "Pulse", "Slow waves time-locked to the pulse at one electrode."),
        o("sweat", "Sweat", "Very slow baseline sway."),
      ],
      defaultText: "Ventilator in the form.",
      onPage: "The artifact during its period on the chosen side.",
      onTrends: "Rhythmic artifacts can raise rhythmicity and seizure probability; slow artifacts change delta power.",
      names: ["event:artifact"],
    },
    {
      id: "artifact-when", name: "Time, duration, side and strength", formLabel: "At min / Duration s / Side / Intensity", where: "form", optionSet: "ARTIFACT_OPTIONS",
      what: "When the artifact occurs, how long, which side, and how strong. Expert mode can name specific electrodes instead of a side.",
      options: [
        o("all", "Side: all", "Every channel."),
        o("left", "Side: left", "Left-sided electrodes."),
        o("right", "Side: right", "Right-sided electrodes."),
        o("low", "Intensity: low", "Subtle."),
        o("medium", "Intensity: medium", "Clearly visible."),
        o("high", "Intensity: high", "Dominates the channels."),
      ],
      defaultText: "Form: middle of the recording, 180 s, all channels, medium (60 s if left out in Expert mode).",
      onPage: "The artifact's extent on the page.",
      names: [],
    },
    {
      id: "baseline-blinks", name: "Background blinks", where: "advanced",
      what: "Spontaneous blinks throughout wakefulness: rate per minute and voltage at Fp.",
      range: "0–60 per minute; 0–500 µV.",
      defaultText: "15 per minute awake (0 when unreactive; neonates about 2 per minute and only with a sleep–wake cycle). 250 µV for children and infants, 300 µV for adults.",
      onPage: "Downward deflections in Fp1–F3 and Fp2–F4 about 3–5 times the background; the posterior rhythm is best just after a blink.",
      names: ["bg:blink_rate_per_min", "bg:blink_amplitude_uv"],
    },
    {
      id: "baseline-ecg", name: "Background ECG", where: "advanced",
      what: "ECG contamination throughout the recording.",
      range: "0–30 µV.",
      defaultText: "2–3.5 µV by age; higher through burst suppression interburst periods so it is visible there.",
      onPage: "Small QRS-locked deflections, clearest in low-voltage periods.",
      names: ["bg:baseline_ecg_uv"],
    },
  ],
};

const display: GuideSection = {
  id: "display",
  title: "How it appears on the page",
  summary: "Display filters, sensitivity, polarity and what the amplitudes mean.",
  intro: [
    "Rendered pages and figures are drawn as a review station would draw them. In the viewer and in Persyst, learners set their own filters, sensitivity and montage; these settings describe the default pages made with a case.",
  ],
  controls: [
    {
      id: "filters", name: "Display filters", where: "advanced",
      what: "Low-frequency filter, high-frequency filter and notch. The low-frequency filter is a single-pole, forward-only filter like a clinical time constant, so blinks, eye movements and pops keep their true shape and slow artifacts are not erased.",
      defaultText: "Low-frequency filter 1 Hz, high-frequency filter 70 Hz, 60 Hz notch (off when a 60 Hz artifact is placed).",
      onPage: "Clinical-looking waveforms with no ringing before sharp deflections.",
      names: [],
    },
    {
      id: "sensitivity", name: "Sensitivity and page length", where: "advanced",
      what: "Microvolts per millimetre and seconds per page.",
      range: "1–100 µV/mm; 5–30 s.",
      defaultText: "7 µV/mm and 15-second pages. Child pages are usually reviewed at 10 µV/mm.",
      onPage: "A lower µV/mm value makes the same voltage look taller.",
      names: [],
    },
    {
      id: "polarity-convention", name: "Polarity convention", where: "advanced",
      what: "Pages are drawn negative-up, as clinical EEG is: a surface-negative discharge points up in a referential montage and phase-reverses in a bipolar chain.",
      defaultText: "Negative up.",
      onPage: "Sporadic spikes and periodic discharges are surface negative unless you choose otherwise; triphasic waves have a positive second phase.",
      names: [],
    },
    {
      id: "amplitude-meaning", name: "What the amplitudes mean", where: "form",
      what: "Background and event voltages are what a reader measures peak-to-peak on the longitudinal bipolar page. For the background it is the typical one-second peak-to-peak away from blinks; for generalized seizures it is the largest bipolar derivation.",
      defaultText: "Applies in editions 2 and 3.",
      onPage: "If you enter 90 µV, a learner measuring the awake background on the bipolar page finds about 90 µV (normal awake child 80–100 µV).",
      names: [],
    },
  ],
};

const trends: GuideSection = {
  id: "trends",
  title: "Trends",
  summary: "aEEG, spectrogram, suppression ratio, asymmetry, rhythmicity and seizure probability.",
  intro: [
    "Every trend is calculated from the same synthetic recording the pages come from, so a trend change always has a cause on the raw EEG. The recording's trend file (and optional Persyst processing) is what learners see in the viewer.",
  ],
  controls: [
    {
      id: "trend-aeeg", name: "Amplitude-integrated EEG (aEEG)", where: "form",
      what: "Left and right compressed amplitude on a semi-logarithmic scale.",
      defaultText: "Shown.",
      onPage: "Upper and lower margins; seizures raise the lower margin, discontinuity and suppression lower it.",
      names: [],
    },
    {
      id: "trend-fft", name: "Spectrogram", where: "form",
      what: "Colour display of power by frequency over time for each hemisphere (or four regions: left and right, lateral and parasagittal) on a fixed −10 to 25 dB scale.",
      defaultText: "Shown for left and right.",
      onPage: "Seizures appear as arch-shaped bands; spindles as a sigma band in sleep; sedation adds beta or alpha bands.",
      names: [],
    },
    {
      id: "trend-sr", name: "Suppression ratio", where: "form",
      what: "Percentage of each minute below 5 µV peak-to-peak, measured in half-second epochs and averaged over the preceding minute.",
      defaultText: "Shown for left and right.",
      onPage: "Rises with burst suppression and postictal attenuation; reaches a sedation target over its ramp.",
      names: [],
    },
    {
      id: "trend-asym", name: "Asymmetry", where: "form",
      what: "Relative asymmetry spectrogram and an asymmetry index between hemispheres.",
      defaultText: "Shown.",
      onPage: "Deflects toward a side with attenuation, slowing or a lateralized seizure.",
      names: [],
    },
    {
      id: "trend-rhythm", name: "Rhythmicity", where: "form",
      what: "Rhythmic activity by frequency for each hemisphere.",
      defaultText: "Shown for left and right.",
      onPage: "Bands during seizures and rhythmic patterns; rhythmic artifact can also appear.",
      names: [],
    },
    {
      id: "trend-szp", name: "Seizure probability", where: "form",
      what: "An illustrative teaching heuristic based on sustained rhythmic slow activity against an early reference period. It is not a validated seizure detector and not an implementation of any commercial detector.",
      defaultText: "Shown.",
      onPage: "Peaks with seizures; can be fooled by rhythmic artifact, which is itself a teaching point.",
      names: [],
    },
    {
      id: "trend-other", name: "Other trends", where: "advanced",
      what: "Envelope trend, total power, alpha/delta and theta/delta ratios (by side, lateral and parasagittal, or paired on one plot), with adjustable axes and suppression thresholds.",
      defaultText: "Available for question-bank figures.",
      onPage: "Ratios fall with regional attenuation that spares delta.",
      names: [],
    },
  ],
};

export const GUIDE_SECTIONS: GuideSection[] = [
  recording, background, sleep, neonatal, focal, generalized, acns, interictal, stimulation, sedation, variants,
  artifacts, display, trends,
];

// ── walkthroughs ───────────────────────────────────────────────────────────

export const GUIDE_WALKTHROUGHS: GuideWalkthrough[] = [
  {
    id: "normal-child",
    title: "Normal awake and sleeping child",
    teaches: "Posterior dominant rhythm, eye state, drowsiness and N2 sleep transients.",
    steps: [
      { label: "Recording", detail: "Age band Child, Standard 19, longitudinal bipolar, 90 minutes, renderer defaults edition 3." },
      { label: "Background", detail: "Continuous, reactivity present; leave the frequency (8 Hz), amplitude (90 µV) and slow fraction (0.4) at the age defaults the form fills in." },
      { label: "Events", detail: "State change to Sleep at 30 minutes; State change to Wake at 80 minutes." },
    ],
    expect: [
      "Awake pages: an 8 Hz posterior rhythm that attenuates with eyes open and is best just after blinks; anterior–posterior gradient.",
      "After 30 minutes: drowsiness, then vertex waves, spindles and K-complexes in N2, and N3 slow waves; blinks stop.",
      "Trends: delta power and aEEG rise during sleep; a sigma band appears on the spectrogram.",
    ],
  },
  {
    id: "focal-seizure",
    title: "Focal seizure with evolution",
    teaches: "Mesial temporal onset, evolution and postictal slowing.",
    steps: [
      { label: "Recording", detail: "Child, Standard 19 + T1/T2, longitudinal with T1/T2, 60 minutes, edition 3." },
      { label: "Background", detail: "Continuous, 8 Hz, 90 µV, reactivity present." },
      { label: "Seizure", detail: "Onset 20 minutes, 90 s, left mesial temporal, spread hemispheric, 6 → 2 Hz, 80 → 200 µV, postictal attenuation 60 s, onset pattern by region." },
    ],
    expect: [
      "Rhythmic theta building at F7/T1 from the first second, slowing and increasing in voltage, spreading across the left hemisphere, ending with clonic bursts.",
      "Postictal left-sided slowing and lower voltage for about a minute.",
      "Trends: left spectrogram arch, rise in rhythmicity and seizure probability, raised aEEG lower margin, then a brief postictal dip.",
    ],
  },
  {
    id: "lpds",
    title: "LPDs in an encephalopathic patient",
    teaches: "ACNS terminology, modifiers, and the difference between a periodic pattern and a seizure.",
    steps: [
      { label: "Recording", detail: "Adolescent, Standard 19, longitudinal bipolar, 120 minutes, edition 3." },
      { label: "Background", detail: "Continuous, 5 Hz, 40 µV, slow fraction 0.7, reactivity absent." },
      { label: "Pattern", detail: "ACNS pattern LPDs, left hemisphere, onset 10 minutes, 100 minutes, 1 Hz, 100 µV, plus modifier +F, prevalence abundant, not evolving." },
      { label: "Optional", detail: "Add a second LPDs event later with Evolving on to contrast an evolving pattern." },
    ],
    expect: [
      "Surface-negative discharges at about 1 Hz over the left hemisphere, phase-reversing in the left chains, with superimposed fast activity, present on most pages.",
      "No sleep cycling or reactivity.",
      "Trends: modest left rhythmicity; aEEG and seizure probability stay flat unless the pattern evolves.",
    ],
  },
  {
    id: "neonatal-quiet-sleep",
    title: "Term neonate in quiet sleep",
    teaches: "Tracé alternant and term sleep–wake cycling.",
    steps: [
      { label: "Recording", detail: "Neonate, Neonatal reduced (9), neonatal montage, 180 minutes, edition 3." },
      { label: "Background", detail: "Tracé alternant for a quiet-sleep recording. For a full sleep–wake cycle, use Expert mode: postmenstrual age 40 weeks and the term sleep–wake cycle." },
      { label: "Optional", detail: "Add a focal seizure of at least 10 s (for example right central) to contrast a neonatal seizure with normal state change." },
    ],
    expect: [
      "Quiet-sleep pages: 3–8 s bursts alternating with lower-voltage (not suppressed) periods; active sleep and wake are continuous.",
      "No blinks except about 2 per minute when awake in the cycle.",
      "Trends: cyclic widening of the aEEG band with quiet sleep.",
    ],
  },
  {
    id: "sedation-bs",
    title: "Burst suppression on sedation",
    teaches: "Drug-induced burst suppression and the suppression ratio trend.",
    steps: [
      { label: "Recording", detail: "Child, Standard 19, longitudinal bipolar, 240 minutes, edition 3." },
      { label: "Background", detail: "Continuous, 7 Hz, 90 µV, reactivity present." },
      { label: "Sedation", detail: "Sedation change at 60 minutes: increase, pentobarbital, target 80% suppression, ramp 30 minutes. Optionally a decrease at 180 minutes to 0%." },
      { label: "Artifact", detail: "Optionally ventilator artifact at 120 minutes to show how artifact reads during suppression." },
    ],
    expect: [
      "Barbiturate fast activity as sedation deepens, then burst suppression with genuine bursts and a low but not flat interburst; ECG visible in the interburst.",
      "Posterior rhythm, blinks and muscle disappear under deep sedation.",
      "Trends: suppression ratio climbs to about 80% over the ramp; the aEEG lower margin falls toward zero.",
    ],
  },
  {
    id: "absence",
    title: "Childhood absence",
    teaches: "Typical absence against a normal background.",
    steps: [
      { label: "Recording", detail: "Child, Standard 19, longitudinal bipolar, 30 minutes, edition 3." },
      { label: "Background", detail: "Continuous, 8 Hz, 90 µV, reactivity present." },
      { label: "Seizures", detail: "Two generalized seizures, Typical absence, at 8 and 20 minutes, 10 s each, provoked by hyperventilation. Add a hyperventilation build-up variant before the second if you want the activation seen." },
    ],
    expect: [
      "Abrupt 3 Hz generalized spike-and-wave, frontally predominant, several times the background, with abrupt return to a normal background.",
      "Trends: little change on hourly trends; the teaching is on the page.",
    ],
  },
];

export const GUIDE_LIMITS: string[] = [
  "The EEG is synthetic and made for teaching. It resembles published reference examples but is not a validated model of any patient or condition.",
  "Adult presets and some rare patterns have had less expert review than the pediatric ones.",
  "The seizure probability trend is an illustrative heuristic, not a validated detector. Event settings and measured trend values need not match numerically.",
  "\"Provoked by\", clinical correlates and annotations are recorded with the case but never change the signal.",
];
