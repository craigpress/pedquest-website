// Single source of truth for matching PubMed-style author strings ("Press CA")
// to PedQuEST consortium member IDs. Both the admin manual-entry flow and the
// cron publication scanner MUST use these helpers so tagging never drifts.

export const MEMBER_NAME_MAP: Record<string, string[]> = {
  // Leadership
  "craig-press": ["Press CA", "Press C"],
  "giulia-benedetti": ["Benedetti GM", "Benedetti G"],
  "dana-harrar": ["Harrar DB", "Harrar D"],
  "nicholas-abend": ["Abend NS"],
  "raquel-farias-moeller": ["Farias-Moeller R"],
  "ajay-thomas": ["Thomas AX"],
  "anuj-jayakar": ["Jayakar A"],
  "rishi-ganesan": ["Ganesan SL"],
  "joost-wagenaar": ["Wagenaar JB", "Wagenaar J"],
  "cecil-hahn": ["Hahn CD"],
  "james-riviello": ["Riviello JJ"],
  "laura-caligiuri": ["Caligiuri L"],
  "adam-ostendorf": ["Ostendorf AP"],
  "brian-appavu": ["Appavu B"],
  "matthew-kirschen": ["Kirschen MP"],
  "arnold-sansevere": ["Sansevere AJ"],
  "tobias-loddenkemper": ["Loddenkemper T"],
  "kerri-larovere": ["LaRovere KL"],
  "conall-francoeur": ["Francoeur C"],
  // Members
  "riley-kessler": ["Kessler R"],
  "mark-wainwright": ["Wainwright M", "Wainwright MS"],
  "agnes-kielian": ["Kielian A"],
  "chelsey-ortman": ["Ortman C"],
  "christopher-ruzas": ["Ruzas C"],
  "caroline-conley": ["Conley CR", "Conley C"],
  "daniel-davila-williams": ["Davila-Williams D", "Williams DD"],
  "dennis-leung": ["Leung D", "Leung DS"],
  "kara-hildebrandt": ["Hildebrandt K"],
  "joy-goldstein": ["Goldstein J", "Goldstein JL"],
  "michael-wolf": ["Wolf M", "Wolf MJ"],
  "amanda-sandoval-karamian": ["Sandoval Karamian A", "Sandoval-Karamian A", "Karamian AS"],
  "jennifer-keene": ["Keene JC", "Keene J"],
  "edgard-andrade": ["Andrade E"],
  "archana-nelliot": ["Nelliot A"],
  "bradley-de-souza": ["De Souza B", "DeSouza B"],
  "brittany-sprigg": ["Sprigg B"],
  "christie-becu": ["Becu C"],
  "rusty-novotny": ["Novotny E", "Novotny ER"],
  "elora-hussain": ["Hussain E"],
  "erica-prendergast": ["Prendergast E"],
  "ekta-shah": ["Shah E"],
  "ethan-rosenberg": ["Rosenberg E"],
  "georgios-ntolkeras": ["Ntolkeras G"],
  "gretchen-vonallmen": ["VonAllmen G", "vonAllmen G"],
  "jennifer-gettings": ["Gettings J"],
  "jerry-jewell": ["Jewell J"],
  "jose-pineda": ["Pineda J", "Pineda Soto J"],
  "kirsten-wilhelm": ["Wilhelm K"],
  "leah-ferrante": ["Ferrante L"],
  "lindsey-morgan": ["Morgan L"],
  "maayke-hunfeld": ["Hunfeld M"],
  "mauro-caffarelli": ["Caffarelli M"],
  "emma-mazzio": ["Mazzio E"],
  "mike-cronin": ["Cronin M"],
  "michaela-waak": ["Waak M"],
  "miles-fisher": ["Fisher M"],
  "neelima-marupud": ["Marupudi N", "Marupud N"],
  "neil-munjal": ["Munjal N"],
  "rej-guerriero": ["Guerriero R"],
  "robert-van-den-berg": ["van den Berg R"],
  "rachel-pauley": ["Pauley R"],
  "robert-stowe": ["Stowe R"],
  "rohit-jain": ["Jain R"],
  "rebecca-silverstein": ["Silverstein R"],
  "stephanie-rau": ["Rau S"],
  "sonali-sen": ["Sen S"],
  "salman-rashid": ["Rashid S"],
  "theresa-czech": ["Czech T"],
  "taylor-nickerson": ["Nickerson T"],
  "tyler-spivey": ["Spivey T"],
  "yi-chen-lai": ["Lai YC", "Lai Y"],
  "joshua-l-goldstein": ["Goldstein JL", "Goldstein J"],
  "carlos-castillo-pinto": ["Castillo Pinto C", "Castillo-Pinto C"],
};

export const MEMBER_DISPLAY_NAMES: Record<string, string> = {
  // Leadership
  "craig-press": "Craig A. Press",
  "giulia-benedetti": "Giulia M. Benedetti",
  "dana-harrar": "Dana B. Harrar",
  "nicholas-abend": "Nicholas S. Abend",
  "raquel-farias-moeller": "Raquel Farias-Moeller",
  "ajay-thomas": "Ajay X. Thomas",
  "anuj-jayakar": "Anuj Jayakar",
  "rishi-ganesan": "Rishi Ganesan",
  "joost-wagenaar": "Joost B. Wagenaar",
  "cecil-hahn": "Cecil D. Hahn",
  "james-riviello": "James J. Riviello",
  "laura-caligiuri": "Laura Caligiuri",
  "adam-ostendorf": "Adam P. Ostendorf",
  "brian-appavu": "Brian Appavu",
  "matthew-kirschen": "Matthew P. Kirschen",
  "arnold-sansevere": "Arnold J. Sansevere",
  "tobias-loddenkemper": "Tobias Loddenkemper",
  "kerri-larovere": "Kerri L. LaRovere",
  "conall-francoeur": "Conall Francoeur",
  // Members
  "riley-kessler": "Riley Kessler",
  "mark-wainwright": "Mark Wainwright",
  "agnes-kielian": "Agnes Kielian",
  "chelsey-ortman": "Chelsey Ortman",
  "christopher-ruzas": "Christopher Ruzas",
  "caroline-conley": "Caroline R Conley",
  "daniel-davila-williams": "Daniel Davila Williams",
  "dennis-leung": "Dennis Leung",
  "kara-hildebrandt": "Kara Hildebrandt",
  "joy-goldstein": "Joy Goldstein",
  "michael-wolf": "Michael Wolf",
  "amanda-sandoval-karamian": "Amanda Sandoval Karamian",
  "jennifer-keene": "Jennifer C. Keene",
  "edgard-andrade": "Edgard Andrade",
  "archana-nelliot": "Archana Nelliot",
  "bradley-de-souza": "Bradley De Souza",
  "brittany-sprigg": "Brittany Sprigg",
  "christie-becu": "Christie Becu",
  "rusty-novotny": "Rusty Novotny",
  "elora-hussain": "Elora Hussain",
  "erica-prendergast": "Erica Prendergast",
  "ekta-shah": "Ekta Shah",
  "ethan-rosenberg": "Ethan Rosenberg",
  "georgios-ntolkeras": "Georgios Ntolkeras",
  "gretchen-vonallmen": "Gretchen VonAllmen",
  "jennifer-gettings": "Jennifer Gettings",
  "jerry-jewell": "Jerry Jewell",
  "jose-pineda": "Jose Pineda",
  "kirsten-wilhelm": "Kirsten Wilhelm",
  "leah-ferrante": "Leah Ferrante",
  "lindsey-morgan": "Lindsey Morgan",
  "maayke-hunfeld": "Maayke Hunfeld",
  "mauro-caffarelli": "Mauro Caffarelli",
  "emma-mazzio": "Emma Mazzio",
  "mike-cronin": "Mike Cronin",
  "michaela-waak": "Michaela Waak",
  "miles-fisher": "Miles Fisher",
  "neelima-marupud": "Neelima Marupud",
  "neil-munjal": "Neil Munjal",
  "rej-guerriero": "Rej Guerriero",
  "robert-van-den-berg": "Robert van den Berg",
  "rachel-pauley": "Rachel Pauley",
  "robert-stowe": "Robert Stowe",
  "rohit-jain": "Rohit Jain",
  "rebecca-silverstein": "Rebecca Silverstein",
  "stephanie-rau": "Stephanie Rau",
  "sonali-sen": "Sonali Sen",
  "salman-rashid": "Salman Rashid",
  "theresa-czech": "Theresa Czech",
  "taylor-nickerson": "Taylor Nickerson",
  "tyler-spivey": "Tyler Spivey",
  "yi-chen-lai": "Yi-Chen Lai",
  "joshua-l-goldstein": "Joshua L Goldstein",
  "carlos-castillo-pinto": "Carlos Castillo Pinto",
};

/**
 * Return the member ID for a single PubMed-style author string ("Press CA"),
 * or null if it does not match any consortium member. A variant matches when
 * the author string equals it or starts with it (so "Press CA" matches the
 * "Press C" variant, tolerating extra initials).
 */
export function matchAuthorToMember(author: string): string | null {
  const norm = author.trim();
  if (!norm) return null;
  for (const [memberId, variants] of Object.entries(MEMBER_NAME_MAP)) {
    if (variants.some((v) => norm === v || norm.startsWith(v))) {
      return memberId;
    }
  }
  return null;
}

/**
 * Given a full author list, return every consortium member ID present,
 * de-duplicated and in member-map order.
 */
export function matchMemberAuthors(authors: string[]): string[] {
  const matched: string[] = [];
  for (const [memberId, variants] of Object.entries(MEMBER_NAME_MAP)) {
    for (const author of authors) {
      const norm = author.trim();
      if (variants.some((v) => norm === v || norm.startsWith(v))) {
        if (!matched.includes(memberId)) matched.push(memberId);
        break;
      }
    }
  }
  return matched;
}
