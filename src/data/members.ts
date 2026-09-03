// Public entry point for member data.
//
// `members` is GENERATED from the Supabase `members` table at build time
// (scripts/generate-members.ts, wired to `prebuild`) - edit members in
// /admin, not here. Everything else in this file is hand-maintained.

export type { Member } from "./member-types";
export { members } from "./members.generated";

export const CONTINENT_BY_COUNTRY: Record<string, string> = {
  USA: "North America",
  "United States": "North America",
  Canada: "North America",
  Netherlands: "Europe",
  Australia: "Oceania",
  "South Korea": "Asia",
};

export const institutions = [
  { name: "Children's Hospital of Philadelphia", city: "Philadelphia, PA", country: "USA", lat: 39.9483, lng: -75.1935 },
  { name: "University of Michigan", city: "Ann Arbor, MI", country: "USA", lat: 42.2808, lng: -83.7430 },
  { name: "Children's National Hospital", city: "Washington, DC", country: "USA", lat: 38.9296, lng: -77.0154 },
  { name: "Medical College of Wisconsin", city: "Milwaukee, WI", country: "USA", lat: 43.0451, lng: -87.9177 },
  { name: "Baylor College of Medicine / Texas Children's Hospital", city: "Houston, TX", country: "USA", lat: 29.7101, lng: -95.4015 },
  { name: "Nicklaus Children's Hospital", city: "Miami, FL", country: "USA", lat: 25.7243, lng: -80.2717 },
  { name: "Royal Children's Hospital", city: "Melbourne, VIC", country: "Australia", lat: -37.7944, lng: 144.9507 },
  { name: "University of Pennsylvania", city: "Philadelphia, PA", country: "USA", lat: 39.9522, lng: -75.1932 },
  { name: "The Hospital for Sick Children", city: "Toronto, ON", country: "Canada", lat: 43.6590, lng: -79.3871 },
  { name: "Texas Children's Hospital", city: "Houston, TX", country: "USA", lat: 29.7101, lng: -95.4015 },
  { name: "Phoenix Children's Hospital", city: "Phoenix, AZ", country: "USA", lat: 33.4605, lng: -112.0628 },
  { name: "Boston Children's Hospital", city: "Boston, MA", country: "USA", lat: 42.3370, lng: -71.1050 },
  { name: "Nationwide Children's Hospital", city: "Columbus, OH", country: "USA", lat: 39.9570, lng: -82.9870 },
  { name: "University of Washington / Seattle Children's", city: "Seattle, WA", country: "USA", lat: 47.6625, lng: -122.2876 },
  { name: "Dell Children's Hospital", city: "Austin, TX", country: "USA", lat: 30.3113, lng: -97.7388 },
  { name: "Children's Hospital Colorado", city: "Aurora, CO", country: "USA", lat: 39.7405, lng: -104.8319 },
  { name: "Ministere de la Sante (QC)", city: "Quebec City, QC", country: "Canada", lat: 46.8139, lng: -71.2080 },
  { name: "Texas Children's Hospital / Baylor", city: "Houston, TX", country: "USA", lat: 29.7101, lng: -95.4015 },
  { name: "Central Michigan University", city: "Mount Pleasant, MI", country: "USA", lat: 43.5978, lng: -84.7675 },
  { name: "Emory University / Children's Healthcare of Atlanta", city: "Atlanta, GA", country: "USA", lat: 33.7490, lng: -84.3880 },
  { name: "Helen DeVos Children's Hospital", city: "Grand Rapids, MI", country: "USA", lat: 42.9634, lng: -85.6681 },
  { name: "Johns Hopkins", city: "Baltimore, MD", country: "USA", lat: 39.2904, lng: -76.6122 },
  { name: "UCSF", city: "San Francisco, CA", country: "USA", lat: 37.7631, lng: -122.4586 },
  { name: "Harvard / Spaulding", city: "Boston, MA", country: "USA", lat: 42.3601, lng: -71.0589 },
  { name: "McGill University", city: "Montreal, QC", country: "Canada", lat: 45.5017, lng: -73.5673 },
  { name: "St. Louis Children's Hospital", city: "St. Louis, MO", country: "USA", lat: 38.6329, lng: -90.2743 },
  { name: "Ann and Robert H. Lurie Children's Hospital", city: "Chicago, IL", country: "USA", lat: 41.8747, lng: -87.6194 },
  { name: "University of Iowa", city: "Iowa City, IA", country: "USA", lat: 41.6611, lng: -91.5302 },
  { name: "Cincinnati Children's Hospital", city: "Cincinnati, OH", country: "USA", lat: 39.1405, lng: -84.5042 },
  { name: "Stanford / Lucile Packard Children's Hospital", city: "Palo Alto, CA", country: "USA", lat: 37.4419, lng: -122.1430 },
  { name: "Stanford", city: "Palo Alto, CA", country: "USA", lat: 37.4419, lng: -122.1430 },
  { name: "Rady Children's Hospital", city: "San Diego, CA", country: "USA", lat: 32.8734, lng: -117.2340 },
  { name: "Duke Children's Hospital", city: "Durham, NC", country: "USA", lat: 36.0082, lng: -78.9282 },
  { name: "Case Western / UH Rainbow Babies", city: "Cleveland, OH", country: "USA", lat: 41.5085, lng: -81.6054 },
  { name: "Massachusetts General Hospital", city: "Boston, MA", country: "USA", lat: 42.3626, lng: -71.0686 },
  { name: "Seoul National University", city: "Seoul", country: "South Korea", lat: 37.4601, lng: 126.9521 },
  { name: "University of Alabama at Birmingham", city: "Birmingham, AL", country: "USA", lat: 33.5021, lng: -86.8025 },
  { name: "Lurie Children's Hospital", city: "Chicago, IL", country: "USA", lat: 41.8747, lng: -87.6194 },
  { name: "University of Michigan / Mott Children's", city: "Ann Arbor, MI", country: "USA", lat: 42.2808, lng: -83.7430 },
  { name: "Boston Children's Hospital / Harvard", city: "Boston, MA", country: "USA", lat: 42.3370, lng: -71.1050 },
  { name: "University of Utah / Primary Children's Hospital", city: "Salt Lake City, UT", country: "USA", lat: 40.7608, lng: -111.8910 },
  { name: "UC Davis Health", city: "Sacramento, CA", country: "USA", lat: 38.5539, lng: -121.4694 },
  { name: "UAMS / Arkansas Children's Hospital", city: "Little Rock, AR", country: "USA", lat: 34.7465, lng: -92.2896 },
  { name: "MaineHealth / Barbara Bush Children's Hospital", city: "Portland, ME", country: "USA", lat: 43.6591, lng: -70.2568 },
  { name: "Washington University / St. Louis Children's Hospital", city: "St. Louis, MO", country: "USA", lat: 38.6329, lng: -90.2743 },
  { name: "McGill University / Montreal Children's Hospital", city: "Montreal, QC", country: "Canada", lat: 45.5017, lng: -73.5673 },
  { name: "Mayo Clinic", city: "Rochester, MN", country: "USA", lat: 44.0225, lng: -92.4631 },
  { name: "Vanderbilt University Medical Center", city: "Nashville, TN", country: "USA", lat: 36.1427, lng: -86.8025 },
  { name: "University of Florida", city: "Gainesville, FL", country: "USA", lat: 29.6516, lng: -82.3248 },
  { name: "Tufts Medical Center", city: "Boston, MA", country: "USA", lat: 42.3496, lng: -71.0636 },
  { name: "Children's Hospital Los Angeles / USC", city: "Los Angeles, CA", country: "USA", lat: 34.0969, lng: -118.2884 },
  { name: "UTHealth Houston / McGovern", city: "Houston, TX", country: "USA", lat: 29.7101, lng: -95.4015 },
  { name: "Erasmus MC", city: "Rotterdam, South Holland", country: "Netherlands", lat: 51.9100, lng: 4.4680 },
  { name: "Queensland Health", city: "Brisbane, QLD", country: "Australia", lat: -27.4705, lng: 153.0260 },
  { name: "Banner Health", city: "Phoenix, AZ", country: "USA", lat: 33.4605, lng: -112.0628 },
  { name: "University of Wisconsin", city: "Madison, WI", country: "USA", lat: 43.0766, lng: -89.4125 },
  { name: "Northwestern University", city: "Evanston, IL", country: "USA", lat: 42.0565, lng: -87.6753 },
  { name: "Northwell Health", city: "New Hyde Park, NY", country: "USA", lat: 40.7648, lng: -73.6825 },
  { name: "London Health Sciences Centre", city: "London, ON", country: "Canada", lat: 43.0130, lng: -81.1500 }
];
