export const ZH_DAILY = 4;
export const EN_DAILY = 6;
export const OTHER_DAILY = 8;
export const FULLTEXT_CAP = 6;

export const ZH_POOL = [
  { name: "報導者", base_url: "https://www.twreporter.org/", feed_url: "https://www.twreporter.org/a/rss2.xml", language: "zh-TW", country: "TW", region: "Asia", source_type: "zh-core" },
  { name: "紐約時報中文網", base_url: "https://cn.nytimes.com/", feed_url: "https://cn.nytimes.com/rss/zh-hant.xml", language: "zh-Hant", country: "US", region: "global", source_type: "zh-core" },
  { name: "巷仔口社會學", base_url: "https://twstreetcorner.org/", feed_url: "https://twstreetcorner.org/feed/", language: "zh-TW", country: "TW", region: "Asia", source_type: "zh-core" },
  { name: "哲學新媒體", base_url: "https://philomedium.com/", feed_url: "https://philomedium.com/feed", language: "zh-TW", country: "TW", region: "Asia", source_type: "zh-core" },
  { name: "歷史學柑仔店", base_url: "https://clio.tw/", feed_url: "https://clio.tw/feed", language: "zh-TW", country: "TW", region: "Asia", source_type: "zh-core" },
  { name: "芭樂人類學", base_url: "https://guavanthropology.tw/", feed_url: "https://guavanthropology.tw/feed", language: "zh-TW", country: "TW", region: "Asia", source_type: "zh-core" },
  { name: "眼底城事", base_url: "https://eyesonplace.net/", feed_url: "https://eyesonplace.net/feed/", language: "zh-TW", country: "TW", region: "Asia", source_type: "zh-core" },
  { name: "換日線 Crossing", base_url: "https://crossing.cw.com.tw/", feed_url: "https://crossing.cw.com.tw/rss", language: "zh-TW", country: "TW", region: "Asia", source_type: "zh-core" },
  { name: "思想坦克", base_url: "https://www.voicettank.org/", feed_url: "https://www.voicettank.org/feed/", language: "zh-TW", country: "TW", region: "Asia", source_type: "zh-core" },
  { name: "菜市場政治學", base_url: "https://whogovernstw.org/", feed_url: "https://whogovernstw.org/feed/", language: "zh-TW", country: "TW", region: "Asia", source_type: "zh-core" },
  { name: "阮一峰的网络日志", base_url: "https://www.ruanyifeng.com/blog/", feed_url: "https://www.ruanyifeng.com/blog/atom.xml", language: "zh-CN", country: "CN", region: "Asia", source_type: "zh-core" },
  { name: "Solidot", base_url: "https://www.solidot.org/", feed_url: "https://www.solidot.org/index.rss", language: "zh-CN", country: "CN", region: "Asia", source_type: "zh-core" },
  { name: "端傳媒 Initium", base_url: "https://theinitium.com/", feed_url: "https://theinitium.com/newsfeed/", language: "zh-Hant", country: "HK", region: "Asia", source_type: "zh-clue" },
  { name: "BBC Chinese", base_url: "https://www.bbc.com/zhongwen/trad", feed_url: "https://feeds.bbci.co.uk/zhongwen/trad/rss.xml", language: "zh-Hant", country: "GB", region: "global", source_type: "zh-core" }
];

export const EN_POOL = [
  { name: "Aeon", base_url: "https://aeon.co/", feed_url: "https://aeon.co/feed.rss", language: "en", country: "AU", region: "global", source_type: "en-discovery" },
  { name: "Literary Hub", base_url: "https://lithub.com/", feed_url: "https://lithub.com/feed/", language: "en", country: "US", region: "global", source_type: "en-discovery" },
  { name: "Paris Review", base_url: "https://www.theparisreview.org/", feed_url: "https://www.theparisreview.org/feed/", language: "en", country: "US", region: "global", source_type: "en-discovery" },
  { name: "History Today", base_url: "https://www.historytoday.com/", feed_url: "https://www.historytoday.com/feed/rss.xml", language: "en", country: "GB", region: "Europe", source_type: "en-discovery" },
  { name: "It's Nice That", base_url: "https://www.itsnicethat.com/", feed_url: "https://www.itsnicethat.com/feed", language: "en", country: "GB", region: "Europe", source_type: "en-discovery" },
  { name: "Eye on Design", base_url: "https://eyeondesign.aiga.org/", feed_url: "https://eyeondesign.aiga.org/feed/", language: "en", country: "US", region: "global", source_type: "en-discovery" },
  { name: "The Quietus", base_url: "https://thequietus.com/", feed_url: "https://thequietus.com/feed/", language: "en", country: "GB", region: "Europe", source_type: "en-discovery" },
  { name: "Senses of Cinema", base_url: "https://www.sensesofcinema.com/", feed_url: "https://www.sensesofcinema.com/feed/", language: "en", country: "AU", region: "global", source_type: "en-discovery" },
  { name: "MUBI Notebook", base_url: "https://mubi.com/notebook", feed_url: "https://mubi.com/notebook/rss", language: "en", country: "multi", region: "global", source_type: "en-discovery" },
  { name: "Rest of World", base_url: "https://restofworld.org/", feed_url: "https://restofworld.org/feed/latest", language: "en", country: "multi", region: "global", source_type: "en-discovery" },
  { name: "Mongabay", base_url: "https://news.mongabay.com/", feed_url: "https://news.mongabay.com/feed/", language: "en", country: "multi", region: "global", source_type: "en-discovery" },
  { name: "JSTOR Daily", base_url: "https://daily.jstor.org/", feed_url: "https://daily.jstor.org/feed/", language: "en", country: "US", region: "global", source_type: "en-discovery" }
];

export const OTHER_POOL = [
  { name: "Le Monde Culture", base_url: "https://www.lemonde.fr/culture/", feed_url: "https://www.lemonde.fr/culture/rss_full.xml", language: "fr", country: "FR", region: "Europe", source_type: "other-lang" },
  { name: "France Culture", base_url: "https://www.franceculture.fr/", feed_url: "https://www.radiofrance.fr/franceculture/rss", language: "fr", country: "FR", region: "Europe", source_type: "other-lang" },
  { name: "El Pais Cultura", base_url: "https://elpais.com/cultura/", feed_url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/cultura/portada", language: "es", country: "ES", region: "Europe", source_type: "other-lang" },
  { name: "Revista Anfibia", base_url: "https://www.revistaanfibia.com/", feed_url: "https://www.revistaanfibia.com/feed/", language: "es", country: "AR", region: "Latin America", source_type: "other-lang" },
  { name: "Die Zeit Kultur", base_url: "https://www.zeit.de/kultur", feed_url: "https://newsfeed.zeit.de/kultur/index", language: "de", country: "DE", region: "Europe", source_type: "other-lang" },
  { name: "Spektrum", base_url: "https://www.spektrum.de/", feed_url: "https://www.spektrum.de/alias/rss/spektrum-de-rss-feed/996406", language: "de", country: "DE", region: "Europe", source_type: "other-lang" },
  { name: "Publico Cultura", base_url: "https://www.publico.pt/culturaipsilon", feed_url: "https://feeds.feedburner.com/PublicoRSS", language: "pt", country: "PT", region: "Europe", source_type: "other-lang" },
  { name: "Revista Piaui", base_url: "https://piaui.folha.uol.com.br/", feed_url: "https://piaui.folha.uol.com.br/feed/", language: "pt", country: "BR", region: "Latin America", source_type: "other-lang" },
  { name: "Cinra", base_url: "https://www.cinra.net/", feed_url: "https://www.cinra.net/feed", language: "ja", country: "JP", region: "Asia", source_type: "other-lang" },
  { name: "Natalie", base_url: "https://natalie.mu/", feed_url: "https://natalie.mu/feed", language: "ja", country: "JP", region: "Asia", source_type: "other-lang" },
  { name: "Raseef22", base_url: "https://raseef22.net/", feed_url: "https://raseef22.net/feed", language: "ar", country: "LB", region: "Middle East", source_type: "other-lang" },
  { name: "Cine21", base_url: "https://www.cine21.com/", feed_url: "https://www.cine21.com/rss", language: "ko", country: "KR", region: "Asia", source_type: "other-lang" },
  { name: "Tempo", base_url: "https://www.tempo.co/", feed_url: "https://rss.tempo.co/", language: "id", country: "ID", region: "Asia", source_type: "other-lang" },
  { name: "Tirto", base_url: "https://tirto.id/", feed_url: "https://tirto.id/rss", language: "id", country: "ID", region: "Asia", source_type: "other-lang" }
];
