export interface GenreCategory {
  name: string;
  genres: string[];
}

export const GENRE_CATEGORIES: GenreCategory[] = [
  { name: "Rock & Guitar-Based", genres: ["Rock", "Alternative Rock", "Indie Rock", "Post-Rock", "Psychedelic Rock", "Classic Rock", "Hard Rock", "Blues Rock", "Folk Rock", "Pop Rock", "Shoegaze", "Grunge", "Emo", "Math Rock", "Garage Rock", "Art Rock", "Surf Rock", "Noise Rock"] },
  { name: "Metal & Heavy", genres: ["Heavy Metal", "Thrash Metal", "Doom Metal", "Death Metal", "Black Metal", "Progressive Metal", "Metalcore", "Deathcore", "Symphonic Metal", "Industrial Metal", "Nu Metal", "Post-Metal", "Stoner Metal", "Sludge Metal"] },
  { name: "Punk & Hardcore", genres: ["Punk Rock", "Hardcore Punk", "Post-Hardcore", "Pop Punk", "Skate Punk", "Street Punk", "Crust Punk", "Melodic Hardcore", "Riot Grrrl"] },
  { name: "Pop & Mainstream", genres: ["Pop", "Indie Pop", "Synth Pop", "Electropop", "Dream Pop", "Bedroom Pop", "Art Pop", "Hyperpop", "Dance Pop", "Acoustic Pop"] },
  { name: "Electronic & Club", genres: ["Electronic", "EDM", "House", "Deep House", "Tech House", "Techno", "Minimal Techno", "Melodic Techno", "Trance", "Ambient", "Downtempo", "IDM", "Breakbeat", "Drum & Bass", "Dubstep", "UK Garage", "Disco", "Nu-Disco"] },
  { name: "Hip Hop & Urban", genres: ["Hip Hop", "Rap", "Trap", "Drill", "Lo-Fi Hip Hop", "Alternative Hip Hop", "Boom Bap", "Jazz Rap", "Conscious Hip Hop"] },
  { name: "R&B, Soul & Funk", genres: ["R&B", "Neo-Soul", "Soul", "Funk", "Disco Funk", "Gospel", "Contemporary R&B"] },
  { name: "Jazz & Improvised", genres: ["Jazz", "Contemporary Jazz", "Swing", "Bebop", "Free Jazz", "Fusion", "Latin Jazz", "Vocal Jazz", "Avant-Garde Jazz"] },
  { name: "Folk & Singer-Songwriter", genres: ["Folk", "Indie Folk", "Contemporary Folk", "Acoustic", "Singer-Songwriter", "Nordic Folk", "Celtic Folk", "Americana", "Roots"] },
  { name: "Country & Roots", genres: ["Country", "Alternative Country", "Outlaw Country", "Bluegrass", "Country Rock", "Americana Country"] },
  { name: "World & Global", genres: ["World Music", "Afrobeat", "Highlife", "Middle Eastern", "Balkan", "Latin", "Salsa", "Cumbia", "Reggaeton", "Samba", "Bossa Nova", "Flamenco"] },
  { name: "Reggae & Caribbean", genres: ["Reggae", "Dub", "Dancehall", "Ska", "Rocksteady"] },
  { name: "Classical & Contemporary", genres: ["Classical", "Contemporary Classical", "Chamber Music", "Minimalism", "Neo-Classical", "Film Music", "Soundtrack"] },
  { name: "Experimental", genres: ["Experimental", "Electro-Acoustic", "Sound Art", "Drone", "Noise", "Improvised"] },
  { name: "Performance & Other", genres: ["DJ Set", "Live Electronic", "Audio-Visual Performance", "Comedy", "Standup", "Drag Show", "Tribute", "Cover Band", "Spoken Word"] },
];

// Simplified venue shortlist
export const VENUE_GENRE_SHORTLIST = ["Pop", "Rock", "Indie", "Alternative", "Singer-Songwriter", "Folk", "Jazz", "Blues", "Soul / R&B", "Funk", "Hip Hop / Rap", "Electronic (Live)", "DJ / Club", "Reggae / Dub / Ska", "Metal", "Punk / Hardcore", "Country / Americana", "World / Global", "Classical / Contemporary Classical", "Experimental / Avant-Garde"];

export const ALL_GENRES: string[] = GENRE_CATEGORIES.flatMap(c => c.genres);
