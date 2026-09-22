const mangayomiSources = [
  {
    "name": "1Anime",
    "id": 384756102,
    "lang": "en",
    "baseUrl": "https://1anime.app",
    "apiUrl": "",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://1anime.app",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.5",
    "pkgPath": "anime/src/en/oneanime.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/oneanime.js",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
  },
];

// 1Anime hides its stream URLs behind an encrypted /api/stream payload. The player in
// its own JS bundle undoes it with, in order: base64 -> ROT13 -> URI-decode -> base64 ->
// Twofish-CTR -> eight rotate+XOR rounds -> XChaCha20 (Poly1305 tag ignored). The keys are
// constants in that bundle, so they are reproduced here; if the site ever rotates them the
// extension re-reads them from the live bundle (see refreshKeys).
var OA_KEYS = {
  xchachaKey: "1aUyfm5UUNKryoTniTqAjMVaEwEgES6L6XIrEPwr4ow=",
  xorKeys: [
    "yjp5Mp5Fm/Bxj+UEo1DXJfy7KWe90yy0pBkwlHgES4M=",
    "8m6O/ud7hs3KpbhX+c6kaIRmh58eiSwTRxCeWxe7k8C6pA2Ll1EMg8EKWBkxVlbyh/BylumqOyybEpE+6yIqkw==",
    "9HVp/21SAFUYJpDPRLtyRE0bahwkzivU2ZejRXp9UCJzyarCrgXdE3saF50of/R1",
    "/GsL09WWV1x9St24SdWOD/pu50osCZ9rV7sf2G/mSq6m4VoFXURr+3fcAq8bfPeswtVU42w9Jc57RY4f1raCdzApES2uhDa2cp4F9EbxN7IH+BRLOrlQVbUPYPjK/uSI0pIItoizOTfvXgMP8jq9hm+dY3B4n94Cd+oZCsgZgmU=",
    "YkJy4TdADnX4V/3GN1LN0WI/KVb6Rlr46nCTxK8NpqqDsGe6UPvvWm6jJqaoRjV/9YGaLWRNXmnXWBxwNQnNsoRMutzeTSMaRKadE7e5Sfvj8mrV03+aERYovw9GL83F",
    "d7evM6Tbf4mPPp2D5YBBAjlYFTFZzqZjY/vxz9+6/0bVu4Oj/9kOkPlABhHh6yNwCqgDRR1kVfBB0t+bQkaAJbiJmZ2J6yu6",
    "ux1un+Xb3MvyDc0NfYzVVjhYVIIdJ0P4NOIV+XwgDChPWtd/g43EwrBG7uULpTOW3itw0+BfFb0=",
    "wNLcvetTxUtiAYq/1BE0TNZ6e6jNQ68crVaYI7EnCI4WBCViyzgZlH817KFc1JDNcaXvnMyw/KS1478l/SLHCqGvcRIqMXC7A9eDo13hC+41UM9IfacIsRUJdqX6fdLJN29SjdTsXiY=",
  ],
  twofishKey: "qzfOKcvybojbr/OObL94mqfZLNJYxEYaElsuLWfA7vA=",
};

// Table-driven Twofish, lifted unchanged from the site's own player bundle (only the
// module wrapper was replaced). Exposes the one-block encrypt used to drive CTR mode.
var OA_TWOFISH = (function () {
    var xt={};var os,ns;const tt=new Uint8Array([169,103,179,232,4,253,163,118,154,146,128,120,228,221,209,
    56,13,198,53,152,24,247,236,108,67,117,55,38,250,19,148,72,242,208,139,48,132,84,223,35,25,91,61,89,
    243,174,162,130,99,1,131,46,217,81,155,124,166,235,165,190,22,12,227,97,192,140,58,245,115,44,37,11,
    187,78,137,107,83,106,180,241,225,230,189,69,226,244,182,102,204,149,3,86,212,28,30,215,251,195,142,
    181,233,207,191,186,234,119,57,175,51,201,98,113,129,121,9,173,36,205,249,216,229,197,185,77,68,8,134,
    231,161,29,170,237,6,112,178,210,65,123,160,17,49,194,39,144,32,246,96,255,150,92,177,171,158,156,82,
    27,95,147,10,239,145,133,73,238,45,79,143,59,71,135,109,70,214,62,105,100,42,206,203,47,252,151,5,122,
    172,127,213,26,75,14,167,90,40,20,63,41,136,60,76,2,184,218,176,23,85,31,138,125,87,199,141,116,183,
    196,159,114,126,21,34,18,88,7,153,52,110,80,222,104,101,188,219,248,200,168,43,64,220,254,50,164,202,
    16,33,240,211,93,15,0,111,157,54,66,74,94,193,224]),rt=new Uint8Array([117,243,198,244,219,123,251,200,
    74,211,230,107,69,125,232,75,214,50,216,253,55,113,241,225,48,15,248,27,135,250,6,63,94,186,174,91,138,
    0,188,157,109,193,177,14,128,93,210,213,160,132,7,20,181,144,44,163,178,115,76,84,146,116,54,81,56,176,
    189,90,252,96,98,150,108,66,247,16,124,40,39,140,19,149,156,199,36,70,59,112,202,227,133,203,17,208,
    147,184,166,131,32,255,159,119,195,204,3,111,8,191,64,231,43,226,121,12,170,130,65,58,234,185,228,154,
    164,151,126,218,122,23,102,148,161,29,61,240,222,179,11,114,167,28,239,209,83,62,143,51,38,95,236,118,
    42,73,129,136,238,33,196,26,235,217,197,57,153,205,173,49,139,1,24,35,221,31,78,45,249,72,79,242,101,
    142,120,92,88,25,141,229,152,87,103,127,5,100,175,99,182,254,245,183,60,165,206,233,104,68,224,77,67,
    105,41,46,172,21,89,168,10,158,110,71,223,52,53,106,207,220,34,201,192,155,137,212,237,171,18,162,13,
    82,187,2,47,169,215,97,30,180,80,4,246,194,22,37,134,86,85,9,190,145]),oi=new Uint32Array([3166450293,
    3974898163,538985414,3014904308,3671720923,33721211,3806473211,2661219016,3385453642,3570665939,404253670,
    505323371,2560101957,2998024317,2795950824,640071499,1010587606,2475919922,2189618904,1381144829,2071712823,
    3149608817,1532729329,1195869153,606354480,1364320783,3132802808,1246425883,3216984199,218984698,2964370182,
    1970658879,3537042782,2105352378,1717973422,976921435,1499012234,0,3452801980,437969053,2930650221,2139073473,
    724289457,3200170254,3772817536,2324303965,993743570,1684323029,3638069408,3890718084,1600120839,454758676,
    741130933,4244419728,825304876,2155898275,1936927410,202146163,2037997388,1802191188,1263207058,1397975412,
    2492763958,2206408529,707409464,3301219504,572704957,3587569754,3183330300,1212708960,4294954594,1280051094,
    1094809452,3351766594,3958056183,471602192,1566401404,909517352,1734852647,3924406156,1145370899,336915093,
    4126522268,3486456007,1061104932,3233866566,1920129851,1414818928,690572490,4042274275,134807173,3334870987,
    4092808977,2358043856,2762234259,3402274488,1751661478,3099086211,943204384,3857002239,2913818271,185304183,
    3368558019,2577006540,1482222851,421108335,235801096,2509602495,1886408768,4160172263,1852755755,522153698,
    3048553849,151588620,1633760426,1465325186,2678000449,2644344890,286352618,623234489,2947538404,1162152090,
    3755969956,2745392279,3941258622,892688602,3991785594,1128528919,4177054566,4227576212,926405537,4210704413,
    3267520573,3031747824,842161630,2627498419,1448535819,3823360626,2273796263,353704732,4193860335,1667481553,
    875866451,2593817918,2981184143,2088554803,2290653990,1027450463,2711738348,3840204662,2172752938,2442199369,
    252705665,4008618632,370565614,3621221153,2543318468,2779097114,4278075371,1835906521,2021174981,3318050105,
    488498585,1987486925,1044307117,3419105073,3065399179,4025441025,303177240,1616954659,1785376989,1296954911,
    3469666638,3739122733,1431674361,2122209864,555856463,50559730,2694850149,1583225230,1515873912,1701137244,
    1650609752,4261233945,101119117,1077970661,4075994776,859024471,387420263,84250239,3907542533,1330609508,
    2307484335,269522275,1953771446,168457726,1549570805,2610656439,757936956,808507045,774785486,1229556201,
    1179021928,2004309316,2829637856,2526413901,673758531,2846435689,3654908201,2256965934,3520169900,4109650453,
    2374833497,3604382376,3115957258,1111625118,4143366510,791656519,3722249951,589510964,3435946549,4059153514,
    3250655951,2240146396,2408554018,1903272393,2425417920,2863289243,16904585,2341200340,1313770733,2391699371,
    2880152082,1869561506,3873854477,3688624722,2459073467,3082270210,1768540719,960092585,3553823959,2812748641,
    2728570142,3284375988,1819034704,117900548,67403766,656885442,2896996118,3503322661,1347425158,3705468758,
    2223250005,3789639945,2054825406,320073617]),ii=new Uint32Array([2849585465,1737496343,3010567324,3906119334,
    67438343,4254618194,2741338240,1994384612,2584233285,2449623883,2158026976,2019973722,3839733679,3719326314,
    3518980963,943073834,223667942,3326287904,895667404,2562650866,404623890,4146392043,3973554593,1819754817,
    1136470056,1966259388,936672123,647727240,4201647373,335103044,2494692347,1213890174,4068082435,3504639116,
    2336732854,809247780,2225465319,1413573483,3741769181,600137824,424017405,1537423930,1030275778,1494584717,
    4079086828,2922473062,2722000751,2182502231,1670713360,22802415,2202908856,781289094,3652545901,1361019779,
    2605951658,2086886749,2788911208,3946839806,2782277680,3190127226,380087468,202311945,3811963120,1629726631,
    3236991120,2360338921,981507485,4120009820,1937837068,740766001,628543696,199710294,3145437842,1323945678,
    2314273025,1805590046,1403597876,1791291889,3029976003,4053228379,3783477063,3865778200,3184009762,1158584472,
    3798867743,4106859443,3056563316,1724643576,3439303065,2515145748,65886296,1459084508,3571551115,471536917,
    514695842,3607942099,4213957346,3273509064,2384027230,3049401388,3918088521,3474112961,3212744085,3122691453,
    3932426513,2005142283,963495365,2942994825,869366908,3382800753,1657733119,1899477947,2180714255,2034087349,
    156361185,2916892222,606945087,3450107510,4187837781,3639509634,3850780736,3316545656,3117229349,1292146326,
    1146451831,134876686,2249412688,3878746103,2714974007,490797818,2855559521,3985395278,112439472,1886147668,
    2989126515,3528604475,1091280799,2072707586,2693322968,290452467,828885963,3259377447,666920807,2427780348,
    539506744,4135519236,1618495560,4281263589,2517060684,1548445029,2982619947,2876214926,2651669058,2629563893,
    1391647707,468929098,1604730173,2472125604,180140473,4013619705,2448364307,2248017928,1224839569,3999340054,
    763158238,1337073953,2403512753,1004237426,1203253039,2269691839,1831644846,1189331136,3596041276,1048943258,
    1764338089,1685933903,714375553,3460902446,3407333062,801794409,4240686525,2539430819,90106088,2060512749,
    2894582225,2140013829,3585762404,447260069,1270294054,247054014,2808121223,1526257109,673330742,336665371,
    1071543669,695851481,2292903662,1009986861,1281325433,45529015,3096890058,3663213877,2963064004,402408259,
    1427801220,536235341,2317113689,2100867762,1470903091,3340292047,2381579782,1953059667,3077872539,3304429463,
    2673257901,1926947811,2127948522,357233908,580816783,312650667,1481532002,132669279,2581929245,876159779,
    1858205430,1346661484,3730649650,1752319558,1697030304,3163803085,3674462938,4173773498,3371867806,2827146966,
    735014510,1079013488,3706422661,4269083146,847942547,2760761311,3393988905,269753372,561240023,4039947444,
    3540636884,1561365130,266490193,0,1872369945,2648709658,915379348,1122420679,1257032137,1593692882,3249241983,
    3772295336]),ai=new Uint32Array([3161832498,3975408673,549855299,3019158473,3671841283,41616011,3808158251,
    2663948026,3377121772,3570652169,417732715,510336671,2554697742,2994582072,2800264914,642459319,1020673111,
    2469565322,2195227374,1392333464,2067233748,3144792887,1542544279,1205946243,607134780,1359958498,3136862918,
    1243302643,3213344584,234491248,2953228467,1967093214,3529429757,2109373728,1722705457,979057315,1502239004,
    0,3451702675,446503648,2926423596,2143387563,733031367,3188637369,3766542496,2321386e3,1003633490,1691706554,
    3634419848,3884246949,1594318824,454302481,750070978,4237360308,824979751,2158198885,1941074730,208866433,
    2035054943,1800694593,1267878658,1400132457,2486604943,2203157279,708323894,3299919004,582820552,3579500024,
    3187457475,1214269560,4284678094,1284918279,1097613687,3343042534,3958893348,470817812,1568431459,908604962,
    1730635712,3918326191,1142113529,345314538,4120704443,3485978392,1059340077,3225862371,1916498651,1416647788,
    701114700,4041470005,142936318,3335243287,4078039887,2362477796,2761139289,3401108118,1755736123,3095640141,
    941635624,3858752814,2912922966,192351108,3368273949,2580322815,1476614381,426711450,235408906,2512360830,
    1883271248,4159174448,1848340175,534912878,3044652349,151783695,1638555956,1468159766,2671877899,2637864320,
    300552548,632890829,2951000029,1167738120,3752124301,2744623964,3934186197,903492952,3984256464,1125598204,
    4167497931,4220844977,933312467,4196268608,3258827368,3035673804,853422685,2629016689,1443583719,3815957466,
    2275903328,354161947,4193253690,1674666943,877868201,2587794053,2978984258,2083749073,2284226715,1029651878,
    2716639703,3832997087,2167046548,2437517569,260116475,4001951402,384702049,3609319283,2546243573,2769986984,
    4276878911,1842965941,2026207406,3308897645,496573925,1993176740,1051541212,3409038183,3062609479,4009881435,
    303567390,1612931269,1792895664,1293897206,3461271273,3727548028,1442403741,2118680154,558834098,66192250,
    2691014694,1586388505,1517836902,1700554059,1649959502,4246338885,109905652,1088766086,4070109886,861352876,
    392632208,92210574,3892701278,1331974013,2309982570,274927765,1958114351,184420981,1559583890,2612501364,
    758918451,816132310,785264201,1240025481,1181238898,2000975701,2833295576,2521667076,675489981,2842274089,
    3643398521,2251196049,3517763975,4095079498,2371456277,3601389186,3104487868,1117667853,4134467265,793194424,
    3722435846,590619449,3426077794,4050317764,3251618066,2245821931,2401406878,1909027233,2428539120,2862328403,
    25756145,2345962465,1324174988,2393607791,2870127522,1872916286,3859670612,3679640562,2461766267,3070408630,
    1764714954,967391705,3554136844,2808194851,2719916717,3283403673,1817209924,117704453,83231871,667035462,
    2887167143,3492139126,1350979603,3696680183,2220196890,3775521105,2059303461,328274927]),li=new Uint32Array([3644434905,
    2417452944,1906094961,3534153938,84345861,2555575704,1702929253,3756291807,138779144,38507010,2699067552,
    1717205094,3719292125,2959793584,3210990015,908736566,1424362836,1126221379,1657550178,3203569854,504502302,
    619444004,3617713367,2000776311,3173532605,851211570,3564845012,2609391259,1879964272,4181988345,2986054833,
    1518225498,2047079034,3834433764,1203145543,1009004604,2783413413,1097552961,115203846,3311412165,1174214981,
    2738510755,1757560168,361584917,569176865,828812849,1047503422,374833686,2500879253,1542390107,1303937869,
    2441490065,3043875253,528699679,1403689811,1667071075,996714043,1073670975,3593512406,628801061,2813073063,
    252251151,904979253,598171939,4036018416,2951318703,2157787776,2455565714,2165076865,657533991,1993352566,
    3881176039,2073213819,3922611945,4043409905,2669570975,2838778793,3304155844,2579739801,2539385239,2202526083,
    1796793963,3357720008,244860174,1847583342,3384014025,796177967,3422054091,4288269567,3927217642,3981968365,
    4158412535,3784037601,454368283,2913083053,215209740,736295723,499696413,425627161,3257710018,2303322505,
    314691346,2123743102,545110560,1678895716,2215344004,1841641837,1787408234,3514577873,2708588961,3472843470,
    935031095,4212097531,1035303229,1373702481,3695095260,759112749,2759249316,2639657373,4001552622,2252400006,
    2927150510,3441801677,76958980,1433879637,168691722,324044307,821552944,3543638483,1090133312,878815796,
    2353982860,3014657715,1817473132,712225322,1379652178,194986251,2332195723,2295898248,1341329743,1741369703,
    1177010758,3227985856,3036450996,674766888,2131031679,2018009208,786825006,122459655,1264933963,3341529543,
    1871620975,222469645,3153435835,4074459890,4081720307,2789040038,1503957849,3166243516,989458234,4011037167,
    4261971454,26298625,1628892769,2094935420,2988527538,1118932802,3681696731,3090106296,1220511560,749628716,
    3821029091,1463604823,2241478277,698968361,2102355069,2491493012,1227804233,398904087,3395891146,3284008131,
    1554224988,1592264030,3505224400,2278665351,2382725006,3127170490,2829392552,3072740279,3116240569,1619502944,
    4174732024,573974562,286987281,3732226014,2044275065,2867759274,858602547,1601784927,3065447094,2529867926,
    1479924312,2630135964,4232255484,444880154,4132249590,475630108,951221560,2889045932,416270104,4094070260,
    1767076969,1956362100,4120364277,1454219094,3672339162,3588914901,1257510218,2660180638,2729120418,1315067982,
    3898542056,3843922405,958608441,3254152897,1147949124,1563614813,1917216882,648045862,2479733907,64674563,
    3334142150,4204710138,2195105922,3480103887,1349533776,3951418603,1963654773,2324902538,2380244109,1277807180,
    337383444,1943478643,3434410188,164942601,277503248,3796963298,0,2585358234,3759840736,2408855183,3871818470,
    3972614892,4258422525,2877276587,3634946264]),Mr=16,An=16843009,Cn=9,rs=8,ci=40,Nt=333;function Tt(e){return e&255}function vt(e){return e>>>8&255}function _t(e){return e>>>16&255}function jt(e){return e>>>24&255}function fr(e,
    t){let r=t>>>24&255,a=(r<<1^(r&128?Nt:0))&255,o=r>>>1^(r&1?Nt>>>1:0)^a;t=t<<8^o<<24^a<<16^o<<8^r;for(let n=0;n<3;n++)r=t>>>24&255,
    a=(r<<1^(r&128?Nt:0))&255,o=r>>>1^(r&1?Nt>>>1:0)^a,t=t<<8^o<<24^a<<16^o<<8^r;t^=e;for(let n=0;n<4;n++)r=t>>>24&255,
    a=(r<<1^(r&128?Nt:0))&255,o=r>>>1^(r&1?Nt>>>1:0)^a,t=t<<8^o<<24^a<<16^o<<8^r;return t}const ge=new Uint32Array(4);function Dr(e,
    t,r,a,o,n,l,c,d){switch(e&3){case 0:n=rt[n]^Tt(o),l=tt[l]^vt(o),c=tt[c]^_t(o),d=rt[d]^jt(o);case 3:n=rt[n]^Tt(a),
    l=rt[l]^vt(a),c=tt[c]^_t(a),d=tt[d]^jt(a);case 2:n=tt[n]^Tt(r),l=rt[l]^vt(r),c=tt[c]^_t(r),d=rt[d]^jt(r);default:case 1:ge[0]=oi[tt[n]^Tt(t)],
    ge[1]=ii[tt[l]^vt(t)],ge[2]=ai[rt[c]^_t(t)],ge[3]=li[rt[d]^jt(t)];return}}function xi(e){let t=e.length;if(t>32)e=e.subarray(0,
    32);else{const C=t&7;if(t===0||C!==0){t+=8-C;const A=new Uint8Array(t);A.set(e),e=A}}const r=t/8,a=new ArrayBuffer(4256),
    o=new Uint32Array(a,0,1024);let n=0,l=e[n++]|e[n++]<<8|e[n++]<<16|e[n++]<<24,c=e[n++]|e[n++]<<8|e[n++]<<16|e[n++]<<24;o[r-1]=fr(l,
    c);let d=e[n++]|e[n++]<<8|e[n++]<<16|e[n++]<<24,f=e[n++]|e[n++]<<8|e[n++]<<16|e[n++]<<24;o[r-2]=fr(d,
    f);const m=e[n++]|e[n++]<<8|e[n++]<<16|e[n++]<<24,p=e[n++]|e[n++]<<8|e[n++]<<16|e[n++]<<24;o[r-3]=fr(m,
    p);const y=e[n++]|e[n++]<<8|e[n++]<<16|e[n++]<<24,D=e[n++]|e[n++]<<8|e[n++]<<16|e[n++]<<24;o[r-4]=fr(y,
    D);let w,x;const _=new Uint32Array(a,4096,40);for(let C=0,A=0,N=0;C<ci/2;C++,N+=2)Dr(r,l,d,m,y,Tt(A),
    vt(A),_t(A),jt(A)),w=ge[0]^ge[1]^ge[2]^ge[3],A+=An,Dr(r,c,f,p,D,Tt(A),vt(A),_t(A),jt(A)),x=ge[0]^ge[1]^ge[2]^ge[3],
    A+=An,x=x<<8|x>>>24,w+=x,_[N]=w,w+=x,_[N+1]=w<<Cn|w>>>32-Cn;l=o[0],c=o[1],d=o[2],f=o[3];for(let C=0,
    A=0;C<256;C++,A+=2)Dr(r,l,c,d,f,C,C,C,C),o[A]=ge[0],o[A+1]=ge[1],o[512+A]=ge[2],o[513+A]=ge[3];return[o,
    _]}ns=xt.makeSession=xi;function ss(e,t,r,a,o,n){e[t++]=r,e[t++]=r>>>8,e[t++]=r>>>16,e[t++]=r>>>24,e[t++]=a,
    e[t++]=a>>>8,e[t++]=a>>>16,e[t++]=a>>>24,e[t++]=o,e[t++]=o>>>8,e[t++]=o>>>16,e[t++]=o>>>24,e[t++]=n,
    e[t++]=n>>>8,e[t++]=n>>>16,e[t++]=n>>>24}function ui(e,t,r,a,[o,n]){if(r.length<a+16)throw new Error("Insufficient space to write ciphertext block.");let l=(e[t++]|e[t++]<<8|e[t++]<<16|e[t++]<<24)^n[0],
    c=(e[t++]|e[t++]<<8|e[t++]<<16|e[t++]<<24)^n[1],d=(e[t++]|e[t++]<<8|e[t++]<<16|e[t++]<<24)^n[2],f=(e[t++]|e[t++]<<8|e[t++]<<16|e[t++]<<24)^n[3],
    m,p,y=rs;for(let D=0;D<Mr;D+=2)m=o[l<<1&510]^o[(l>>>7&510)+1]^o[512+(l>>>15&510)]^o[512+(l>>>23&510)+1],
    p=o[c>>>23&510]^o[(c<<1&510)+1]^o[512+(c>>>7&510)]^o[512+(c>>>15&510)+1],d^=m+p+n[y++],d=d>>>1|d<<31,
    f=f<<1|f>>>31,f^=m+2*p+n[y++],m=o[d<<1&510]^o[(d>>>7&510)+1]^o[512+(d>>>15&510)]^o[512+(d>>>23&510)+1],
    p=o[f>>>23&510]^o[(f<<1&510)+1]^o[512+(f>>>7&510)]^o[512+(f>>>15&510)+1],l^=m+p+n[y++],l=l>>>1|l<<31,
    c=c<<1|c>>>31,c^=m+2*p+n[y++];ss(r,a,d^n[4],f^n[5],l^n[6],c^n[7])}os=xt.encrypt=ui;function di(e,t,r,
    a,[o,n]){if(e.length<t+16)throw new Error("Incomplete ciphertext block.");if(r.length<a+16)throw new Error("Insufficient space to write plaintext block.");let l=(e[t++]|e[t++]<<8|e[t++]<<16|e[t++]<<24)^n[4],
    c=(e[t++]|e[t++]<<8|e[t++]<<16|e[t++]<<24)^n[5],d=(e[t++]|e[t++]<<8|e[t++]<<16|e[t++]<<24)^n[6],f=(e[t++]|e[t++]<<8|e[t++]<<16|e[t++]<<24)^n[7],
    m,p,y=rs+2*Mr-1;for(let D=0;D<Mr;D+=2)m=o[l<<1&510]^o[(l>>>7&510)+1]^o[512+(l>>>15&510)]^o[512+(l>>>23&510)+1],
    p=o[c>>>23&510]^o[(c<<1&510)+1]^o[512+(c>>>7&510)]^o[512+(c>>>15&510)+1],f^=m+2*p+n[y--],f=f>>>1|f<<31,
    d=d<<1|d>>>31,d^=m+p+n[y--],m=o[d<<1&510]^o[(d>>>7&510)+1]^o[512+(d>>>15&510)]^o[512+(d>>>23&510)+1],
    p=o[f>>>23&510]^o[(f<<1&510)+1]^o[512+(f>>>7&510)]^o[512+(f>>>15&510)+1],c^=m+2*p+n[y--],c=c>>>1|c<<31,
    l=l<<1|l>>>31,l^=m+p+n[y--];ss(r,a,d^n[0],f^n[1],l^n[2],c^n[3])}xt.decrypt=di;
  return { encrypt: os, session: ns };
})();

var OA_CRYPTO = (function () {
  var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var LOOKUP = {};
  for (var li = 0; li < ALPHABET.length; li++) LOOKUP[ALPHABET.charAt(li)] = li;

  // atob() / TextDecoder do not exist in Mangayomi's QuickJS runtime.
  function b64bytes(s) {
    s = String(s).replace(/[^A-Za-z0-9+\/]/g, "");
    var out = new Uint8Array(Math.floor(s.length * 3 / 4));
    var acc = 0, bits = 0, o = 0;
    for (var i = 0; i < s.length; i++) {
      acc = (acc << 6) | LOOKUP[s.charAt(i)];
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[o++] = (acc >> bits) & 255;
        acc &= (1 << bits) - 1;
      }
    }
    return out.slice(0, o);
  }

  function asciiString(bytes) {
    var parts = [], chunk = [];
    for (var i = 0; i < bytes.length; i++) {
      chunk.push(bytes[i]);
      if (chunk.length >= 4000) { parts.push(String.fromCharCode.apply(null, chunk)); chunk = []; }
    }
    parts.push(String.fromCharCode.apply(null, chunk));
    return parts.join("");
  }

  function utf8String(b) {
    var parts = [], chunk = [], i = 0, n = b.length;
    while (i < n) {
      var c = b[i++];
      if (c < 128) chunk.push(c);
      else if (c < 224) chunk.push(((c & 31) << 6) | (b[i++] & 63));
      else if (c < 240) chunk.push(((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63));
      else {
        var cp = (((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63)) - 0x10000;
        chunk.push(0xD800 + (cp >> 10), 0xDC00 + (cp & 1023));
      }
      if (chunk.length >= 4000) { parts.push(String.fromCharCode.apply(null, chunk)); chunk = []; }
    }
    parts.push(String.fromCharCode.apply(null, chunk));
    return parts.join("");
  }

  function rot13(s) {
    return s.replace(/[A-Za-z]/g, function (ch) {
      var base = ch <= "Z" ? 65 : 97;
      return String.fromCharCode((ch.charCodeAt(0) - base + 13) % 26 + base);
    });
  }

  function twofishCtr(data, key) {
    var counter = data.slice(0, 16), body = data.slice(16);
    var session = OA_TWOFISH.session(key);
    var out = new Uint8Array(body.length);
    var stream = new Uint8Array(16);
    for (var off = 0; off < body.length; off += 16) {
      OA_TWOFISH.encrypt(counter, 0, stream, 0, session);
      var n = Math.min(16, body.length - off);
      for (var i = 0; i < n; i++) out[off + i] = body[off + i] ^ stream[i];
      for (var p = 15; p >= 0; p--) {
        counter[p] = (counter[p] + 1) & 255;
        if (counter[p] !== 0) break;
      }
    }
    return out;
  }

  function rotateXor(data, key, rot, left) {
    var out = new Uint8Array(data.length);
    for (var i = 0; i < data.length; i++) {
      var v = data[i];
      v = left ? ((v << rot) | (v >> (8 - rot))) & 255 : ((v >> rot) | (v << (8 - rot))) & 255;
      out[i] = v ^ key[i % key.length];
    }
    return out;
  }

  function multiXor(data, keys) {
    var r = data;
    for (var a = keys.length - 1; a >= 0; a--) r = rotateXor(r, keys[a], (a + 1) % 8, a % 2 !== 0);
    return r;
  }

  function rotl(v, n) { return ((v << n) | (v >>> (32 - n))) >>> 0; }

  function quarter(s, a, b, c, d) {
    s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl(s[d] ^ s[a], 16);
    s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl(s[b] ^ s[c], 12);
    s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl(s[d] ^ s[a], 8);
    s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl(s[b] ^ s[c], 7);
  }

  function chachaRounds(s) {
    for (var i = 0; i < 10; i++) {
      quarter(s, 0, 4, 8, 12); quarter(s, 1, 5, 9, 13); quarter(s, 2, 6, 10, 14); quarter(s, 3, 7, 11, 15);
      quarter(s, 0, 5, 10, 15); quarter(s, 1, 6, 11, 12); quarter(s, 2, 7, 8, 13); quarter(s, 3, 4, 9, 14);
    }
  }

  function le32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  var SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];

  function hchacha20(key, nonce16) {
    var s = new Uint32Array(16), i;
    for (i = 0; i < 4; i++) s[i] = SIGMA[i];
    for (i = 0; i < 8; i++) s[4 + i] = le32(key, i * 4);
    for (i = 0; i < 4; i++) s[12 + i] = le32(nonce16, i * 4);
    chachaRounds(s);
    var pick = [0, 1, 2, 3, 12, 13, 14, 15], out = new Uint8Array(32);
    for (i = 0; i < 8; i++) {
      var v = s[pick[i]];
      out[i * 4] = v & 255; out[i * 4 + 1] = (v >>> 8) & 255;
      out[i * 4 + 2] = (v >>> 16) & 255; out[i * 4 + 3] = (v >>> 24) & 255;
    }
    return out;
  }

  function chacha20Xor(key, nonce12, data, counter) {
    var out = new Uint8Array(data.length);
    var st = new Uint32Array(16), w = new Uint32Array(16), i;
    for (i = 0; i < 4; i++) st[i] = SIGMA[i];
    for (i = 0; i < 8; i++) st[4 + i] = le32(key, i * 4);
    st[13] = le32(nonce12, 0); st[14] = le32(nonce12, 4); st[15] = le32(nonce12, 8);
    for (var off = 0; off < data.length; off += 64, counter++) {
      st[12] = counter >>> 0;
      for (i = 0; i < 16; i++) w[i] = st[i];
      chachaRounds(w);
      for (i = 0; i < 16; i++) w[i] = (w[i] + st[i]) >>> 0;
      for (var j = 0; j < 64 && off + j < data.length; j++) {
        out[off + j] = data[off + j] ^ ((w[j >> 2] >>> (8 * (j & 3))) & 255);
      }
    }
    return out;
  }

  // Returns the parsed JSON, or throws if the keys no longer match the payload.
  function decrypt(result, keys) {
    var text = rot13(asciiString(b64bytes(result)));
    var inner = b64bytes(decodeURIComponent(text));
    var stage = twofishCtr(inner, b64bytes(keys.twofishKey));
    var xorKeys = [];
    for (var k = 0; k < keys.xorKeys.length; k++) xorKeys.push(b64bytes(keys.xorKeys[k]));
    var plain = multiXor(stage, xorKeys);
    var nonce = plain.slice(0, 24);
    var cipher = plain.slice(24, plain.length - 16); // last 16 bytes are the Poly1305 tag
    var subKey = hchacha20(b64bytes(keys.xchachaKey), nonce.slice(0, 16));
    var nonce12 = new Uint8Array(12);
    nonce12.set(nonce.slice(16, 24), 4);
    return JSON.parse(utf8String(chacha20Xor(subKey, nonce12, cipher, 1)));
  }

  return { decrypt: decrypt };
})();

// Cached for the life of the isolate. A refresh from the live bundle lands here.
var OA_LIVE_KEYS = null;

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  }

  get headers() {
    return {
      "User-Agent": this.ua,
      "Accept": "application/json",
      "Referer": this.source.baseUrl + "/",
    };
  }

  // ── Listings ──────────────────────────────────────────────────────────────

  get supportsLatest() { return true; }

  async listApi(params) {
    var url = this.source.baseUrl + "/api/animes?" + params;
    var res = await this.client.get(url, this.headers);
    var json = JSON.parse(res.body);
    var info = json.page_info || {};
    return {
      list: this.parseAnimeList(json.data || []),
      hasNextPage: !!info.has_next_page,
    };
  }

  animeTitle(item) {
    var t = (item && item.title) || {};
    if (typeof t === "string") return t;
    return t.english || t.romaji || t.native || "";
  }

  posterOf(item) {
    var p = (item && item.poster) || {};
    return p.large || p.medium || p.small || "";
  }

  parseAnimeList(items) {
    var list = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      list.push({
        name: this.animeTitle(item),
        link: String(item.id),
        imageUrl: this.posterOf(item),
      });
    }
    return list;
  }

  async getPopular(page) {
    try {
      return await this.listApi("page=" + page + "&perPage=24&sort=POPULARITY_DESC&is_adult=0");
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // "Recently aired" is the site's own ordering for episodes that just landed.
  async getLatestUpdates(page) {
    try {
      return await this.listApi("page=" + page + "&perPage=24&sort=LAST_SUBDUB_EPISODE_DESC&is_adult=0");
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    var params = ["page=" + page, "perPage=24", "is_adult=0"];
    var sort = "POPULARITY_DESC";
    var audio = "";

    if (filters && Array.isArray(filters)) {
      for (var i = 0; i < filters.length; i++) {
        var f = filters[i];
        if (f.type_name === "SelectFilter") {
          var opt = f.values && f.values[f.state];
          var v = opt ? opt.value : "";
          if (!v) continue;
          if (f.name === "Sort") sort = v;
          else if (f.name === "Format") params.push("format_in=" + encodeURIComponent(v));
          else if (f.name === "Status") params.push("status_in=" + encodeURIComponent(v));
          else if (f.name === "Season") params.push("season=" + encodeURIComponent(v));
          else if (f.name === "Year") params.push("season_year=" + encodeURIComponent(v));
          else if (f.name === "Audio") audio = v;
        } else if (f.type_name === "GroupFilter" && f.name === "Genres") {
          var gs = f.state || [];
          for (var g = 0; g < gs.length; g++) {
            if (gs[g].state === true) params.push("genres_in=" + encodeURIComponent(gs[g].value));
          }
        }
      }
    }

    if (query && query.trim().length) params.push("search=" + encodeURIComponent(query.trim()));
    if (audio === "sub" || audio === "both") params.push("has_sub=1");
    if (audio === "dub" || audio === "both") params.push("has_dub=1");
    params.push("sort=" + sort);

    try {
      return await this.listApi(params.join("&"));
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  statusCode(status) {
    return ({
      "RELEASING": 0,
      "FINISHED": 1,
      "NOT_YET_RELEASED": 4,
      "CANCELLED": 5,
      "HIATUS": 6,
    }[status]);
  }

  stripHtml(str) {
    return (str || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // Accepts a bare AniList id or a full /anime/<id> or /watch/<id> URL.
  extractId(url) {
    var m = String(url).match(/(\d+)(?:[^\d]*)$/);
    return m ? m[1] : String(url);
  }

  toEpochMs(dateStr) {
    if (!dateStr) return null;
    var t = Date.parse(dateStr);
    return isNaN(t) ? null : String(t);
  }

  async getDetail(url) {
    var id = this.extractId(url);
    var base = this.source.baseUrl;

    // The two calls are independent; the detail payload is the slow one (~200 KB).
    var results = await Promise.all([
      this.client.get(base + "/api/anime/" + id, this.headers),
      this.client.get(base + "/api/episodes-id?id=" + id, this.headers),
    ]);
    var meta = JSON.parse(results[0].body);
    var epJson = JSON.parse(results[1].body);

    var thumbs = true;
    try {
      var pref = new SharedPreferences().get("oneanime_pref_ep_thumbnails");
      if (pref === false) thumbs = false;
    } catch (e) {}

    var audioPref = this.audioPref();
    var eps = epJson.episodes || [];
    var chapters = [];
    for (var i = 0; i < eps.length; i++) {
      var ep = eps[i];
      // Placeholder entries (no sub and no dub) have nothing to play.
      if (!ep.sub && !ep.dub) continue;
      // "Sub only" / "Dub only" hide the episodes that lack that version (dubs lag behind
      // the subs on airing shows, so this is what makes a Dub-only list useful).
      if (audioPref === "sub" && !ep.sub) continue;
      if (audioPref === "dub" && !ep.dub) continue;

      var label = "Episode " + ep.number;
      if (ep.title && !/^Episode\s+\d+$/i.test(ep.title)) label += " - " + ep.title;

      var img = ep.image || "";
      chapters.push({
        name: label,
        // <anilist id the stream API wants>|<episode number>|<sub flag><dub flag>
        url: (ep.anilistId || id) + "|" + ep.number + "|" + (ep.sub ? "1" : "0") + (ep.dub ? "1" : "0"),
        dateUpload: this.toEpochMs(ep.date),
        scanlator: ep.sub && ep.dub ? "Sub & Dub" : (ep.sub ? "Sub" : "Dub"),
        thumbnailUrl: thumbs && /^https?:/.test(img) ? img : null,
        description: ep.description || null,
      });
    }

    var studios = [];
    var ss = meta.studios || [];
    for (var s = 0; s < ss.length; s++) {
      if (ss[s].is_main && ss[s].studio) studios.push(ss[s].studio.name);
    }

    var genres = [];
    var gs = meta.genres || [];
    for (var g = 0; g < gs.length; g++) genres.push(gs[g].name);

    return {
      name: this.animeTitle(meta),
      imageUrl: this.posterOf(meta),
      description: this.stripHtml(meta.description),
      genre: genres,
      author: studios.join(", "),
      status: this.statusCode(meta.status),
      link: base + "/anime/" + id,
      chapters: chapters.reverse(),
    };
  }

  // ── Stream extraction ─────────────────────────────────────────────────────

  newRequestId() {
    var hex = "";
    for (var i = 0; i < 32; i++) hex += Math.floor(Math.random() * 16).toString(16);
    return "watch-" + hex;
  }

  // When the site rotates its cipher keys they are still plain literals in the watch-page
  // chunk. Walk index.html -> entry bundle -> the chunk behind the watch/:id route.
  async refreshKeys() {
    var base = this.source.baseUrl;
    var h = { "User-Agent": this.ua, "Referer": base + "/" };

    var html = (await this.client.get(base + "/", h)).body || "";
    var entry = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
    if (!entry) return null;

    var bundle = (await this.client.get(base + entry[0], h)).body || "";
    var route = bundle.match(/path:"watch\/:id"[\s\S]{0,240}?import\("\.\/([^"]+\.js)"\)/);
    if (!route) return null;

    var chunk = (await this.client.get(base + "/assets/" + route[1], h)).body || "";
    var xc = chunk.match(/xchachaKey:"([^"]+)"/);
    var tw = chunk.match(/twofishKey:"([^"]+)"/);
    var xr = chunk.match(/xorKeys:\[([^\]]+)\]/);
    if (!xc || !tw || !xr) return null;

    var xorKeys = [];
    var lits = xr[1].match(/"([^"]+)"/g) || [];
    for (var i = 0; i < lits.length; i++) xorKeys.push(lits[i].slice(1, -1));
    return { xchachaKey: xc[1], twofishKey: tw[1], xorKeys: xorKeys };
  }

  // One encrypted stream response -> parsed object. Falls back to live keys once.
  async decryptStream(result) {
    var keys = OA_LIVE_KEYS || OA_KEYS;
    try {
      return OA_CRYPTO.decrypt(result, keys);
    } catch (e) {
      if (OA_LIVE_KEYS) throw e; // already on refreshed keys - nothing more to try
    }
    var fresh = await this.refreshKeys();
    if (!fresh) throw new Error("1Anime: could not refresh cipher keys");
    OA_LIVE_KEYS = fresh;
    return OA_CRYPTO.decrypt(result, fresh);
  }

  // A failure here is reported, not swallowed: getVideoList used to turn every error into an
  // empty list, which the app shows as a bare "no videos" with nothing to report.
  async fetchStream(anilistId, episode, provider, lang) {
    var rid = this.newRequestId();
    var url = this.source.baseUrl + "/api/stream?anilistId=" + anilistId +
      "&providerName=" + provider + "&episodeNumber=" + episode +
      "&subOrDub=" + lang + "&rid=" + rid;
    var h = this.headers;
    h["x-watch-request-id"] = rid;
    h["Referer"] = this.source.baseUrl + "/watch/" + anilistId;

    var res = await this.client.get(url, h);
    if (res.statusCode !== 200) {
      // The API answers {"error": "..."} and the wording names the upstream that failed.
      var why = String(res.body || "").replace(/\s+/g, " ").slice(0, 120);
      throw new Error("HTTP " + res.statusCode + (why ? " " + why : ""));
    }
    var json = JSON.parse(res.body);
    if (!json || !json.result) throw new Error("empty response");
    var data = await this.decryptStream(json.result);
    if (!data || data.success === false) throw new Error("stream refused");
    return data;
  }

  // The site's own Source menu lists ZenV2 and Zen as "Official Server". They are the same
  // flixcloud video on two CDN mirrors (fetch8 / fetch9), so a server here is only the first
  // hop of the download link - which is what to switch when one mirror is blocked or slow on
  // someone's network. The menu also lists Pahe, Zone, Senshi, Anitaku, AnimeVerse and
  // AnimeHeaven, but on every title and episode checked (2026-09-21) they fail on the
  // site's own backend (dead upstream hosts, 522s, a 403, "no matching anime"), so there is
  // nothing to play and they are deliberately not offered.
  get KNOWN_SERVERS() { return ["ZenV2", "Zen"]; }

  readPref(key, fallback) {
    var v;
    try { v = new SharedPreferences().get(key); } catch (e) {}
    return v === undefined || v === null || v === "" ? fallback : v;
  }

  // "sub_dub" | "dub_sub" | "sub" | "dub", matching AniKoto's own preference. An unset or
  // unknown value reads as "sub_dub".
  audioPref() {
    var a = this.readPref("oneanime_pref_audio", "sub_dub");
    var valid = ["sub_dub", "dub_sub", "sub", "dub"];
    return valid.indexOf(a) >= 0 ? a : "sub_dub";
  }

  // Sub and Dub sit in the exact same file here - every stream carries both audio tracks
  // and every subtitle - so unlike AniKoto's genuinely separate sub/dub sources, this never
  // changes which bytes get fetched, only which labelled entries appear in the picker and
  // in what order. Mangayomi auto-plays the FIRST entry, so order is what "Sub then Dub" /
  // "Dub then Sub" actually control; picking either entry opens the identical stream, so
  // switching tracks for real is the player's own audio menu, same as if there were only one.
  entryKinds(hasSub, hasDub, audio) {
    if (audio === "sub") return hasSub ? ["Sub"] : (hasDub ? ["Dub"] : []);
    if (audio === "dub") return hasDub ? ["Dub"] : (hasSub ? ["Sub"] : []);
    if (!hasSub) return hasDub ? ["Dub"] : [];
    if (!hasDub) return ["Sub"];
    return audio === "dub_sub" ? ["Dub", "Sub"] : ["Sub", "Dub"];
  }

  // The servers the viewer ticked (both by default), in KNOWN_SERVERS order, with the
  // "play first" choice moved to the front. Nothing is dropped by the reordering.
  enabledServers() {
    var all = this.KNOWN_SERVERS;
    var ticked = this.readPref("oneanime_pref_servers", null);
    var picked = all.filter(function (s) { return ticked && ticked.indexOf(s) >= 0; });
    if (!picked.length) picked = all.slice();
    var first = this.readPref("oneanime_pref_server", "auto");
    if (picked.indexOf(first) > 0) {
      picked = [first].concat(picked.filter(function (s) { return s !== first; }));
    }
    return picked;
  }

  headerValue(headers, name) {
    if (!headers) return "";
    var want = name.toLowerCase();
    for (var k in headers) {
      if (String(k).toLowerCase() === want) return String(headers[k] || "");
    }
    return "";
  }

  // The tokenised link's path carries no extension, and the token is bound to that exact
  // path - appending anything to it, even before the query string, answers 400 Bad Request.
  // Confirmed the hard way: the app opens a video's originalUrl (not url) the very first
  // time a fresh player screen appears, before any server switch is possible - on Windows a
  // 400 there left the player stuck on its buffering spinner forever (mpv had already given
  // up, with nothing queued to retry). v0.1.3 papered over the downloader's extension check
  // with a ".mkv" alias of that same broken path; this resolves the *real* file the link
  // redirects to instead, which already ends in a genuine ".mkv" on its own and is always
  // safe to open directly, whichever field it ends up in.
  async resolveDirectUrl(downloadUrl, headers) {
    try {
      var c = new Client({ "useDartHttpClient": true, "followRedirects": false });
      var h = {};
      for (var k in headers) h[k] = headers[k];
      h["Range"] = "bytes=0-0";
      var res = await c.get(downloadUrl, h);
      var loc = this.headerValue(res.headers, "location");
      if (res.statusCode >= 300 && res.statusCode < 400 && /^https?:\/\//.test(loc)) return loc;
    } catch (e) {}
    return null;
  }

  // One fetch produces every kind (["Sub"], ["Dub"], or both, already ordered) offered for
  // this server, since they are the same file - fetching the API a second time for the
  // other audio label would return byte-identical bytes. The requested subOrDub value only
  // has to be one the episode actually has; which one is irrelevant to the result.
  async videosFromServer(anilistId, episode, server, kinds) {
    try {
      var lang = kinds[0] === "Dub" ? "d" : "s";
      var data = await this.fetchStream(anilistId, episode, server, lang);
      var dl = data.download && data.download[0] && data.download[0].url;
      if (!dl) return { error: server + ": no download link" };

      // The API says exactly what the CDN wants (just a Referer), so the player gets exactly
      // that. No User-Agent: the CDN does not check it, and mpv splits its header list on
      // commas, which a browser UA ("KHTML, like Gecko") would break.
      var headers = {};
      var given = data.headers || {};
      for (var k in given) headers[k] = given[k];

      // The tokenised link is good for 6 hours and the CDN re-signs it on every request, so
      // it is what plays and what a queued or retried download uses. It is dead 15 minutes
      // after this direct file link is issued (404, mid-file ranges included) - reopen the
      // episode if a very long session outlives that.
      var direct = await this.resolveDirectUrl(dl, headers);

      // Mangayomi's downloader only offers a download when a video's originalUrl path ends
      // in a known video extension (.mkv is on its list), and fetches `url` - never
      // originalUrl - so this only ever affects which entries can be downloaded.
      var videos = [];
      for (var i = 0; i < kinds.length; i++) {
        videos.push({
          url: dl,
          originalUrl: direct || dl,
          quality: server + " · " + kinds[i],
          headers: headers,
          subtitles: [],
        });
      }
      return { videos: videos };
    } catch (e) {
      return { error: server + ": " + (e && e.message ? e.message : String(e)) };
    }
  }

  async getVideoList(url) {
    var parts = String(url).split("|");
    var anilistId = parts[0];
    var episode = parts[1];
    var flags = parts[2] || "11";
    if (!/^\d+$/.test(anilistId) || !episode) return [];

    var hasSub = flags.charAt(0) !== "0", hasDub = flags.charAt(1) !== "0";
    var kinds = this.entryKinds(hasSub, hasDub, this.audioPref());
    if (!kinds.length) return [];

    // Ticked servers first; the others only as a rescue lane. An episode that refuses to
    // play is worse than one that plays on a server the viewer did not tick.
    var enabled = this.enabledServers();
    var rescue = this.KNOWN_SERVERS.filter(function (s) { return enabled.indexOf(s) < 0; });
    var tiers = rescue.length ? [enabled, rescue] : [enabled];

    var self = this;
    var errors = [];

    for (var t = 0; t < tiers.length; t++) {
      var servers = tiers[t];
      // Every server in the tier is asked at once (the site's own player makes two calls per
      // episode as well), so each one contributing a Sub and/or Dub entry costs no extra
      // requests - the picker ends up showing every combination the tier can offer, not just
      // whichever server happened to answer first.
      var results = await Promise.all(servers.map(function (server) {
        return self.videosFromServer(anilistId, episode, server, kinds);
      }));
      var videos = [];
      for (var r = 0; r < results.length; r++) {
        if (results[r].videos) videos = videos.concat(results[r].videos);
        else if (errors.indexOf(results[r].error) < 0) errors.push(results[r].error);
      }
      if (videos.length) return videos;
    }
    // Throw rather than return []: the player then shows the reason with a Retry button
    // instead of a bare "video list is empty".
    throw new Error("1Anime has no playable stream for this episode (" + errors.join("; ") + ")");
  }

  // ── Filters & preferences ─────────────────────────────────────────────────

  getFilterList() {
    var genres = ["Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy",
      "Horror", "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological",
      "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"];

    var years = [{ type_name: "SelectOption", name: "Any", value: "" }];
    var now = new Date().getFullYear();
    for (var y = now + 1; y >= 1990; y--) {
      years.push({ type_name: "SelectOption", name: String(y), value: String(y) });
    }

    return [
      { type_name: "SelectFilter", name: "Sort", state: 0, values: [
        { type_name: "SelectOption", name: "Popularity",     value: "POPULARITY_DESC" },
        { type_name: "SelectOption", name: "Trending",       value: "TRENDING_DESC" },
        { type_name: "SelectOption", name: "Score",          value: "SCORE_DESC" },
        { type_name: "SelectOption", name: "Favorites",      value: "FAVORITES_DESC" },
        { type_name: "SelectOption", name: "Newest",         value: "START_DATE_DESC" },
        { type_name: "SelectOption", name: "Oldest",         value: "START_DATE_ASC" },
        { type_name: "SelectOption", name: "Title (A-Z)",    value: "TITLE_ROMAJI" },
        { type_name: "SelectOption", name: "Most episodes",  value: "EPISODES_DESC" },
        { type_name: "SelectOption", name: "Recently aired", value: "LAST_SUBDUB_EPISODE_DESC" },
      ]},
      { type_name: "SelectFilter", name: "Format", state: 0, values: [
        { type_name: "SelectOption", name: "Any",      value: "" },
        { type_name: "SelectOption", name: "TV",       value: "TV" },
        { type_name: "SelectOption", name: "TV Short", value: "TV_SHORT" },
        { type_name: "SelectOption", name: "Movie",    value: "MOVIE" },
        { type_name: "SelectOption", name: "OVA",      value: "OVA" },
        { type_name: "SelectOption", name: "ONA",      value: "ONA" },
        { type_name: "SelectOption", name: "Special",  value: "SPECIAL" },
        { type_name: "SelectOption", name: "Music",    value: "MUSIC" },
      ]},
      { type_name: "SelectFilter", name: "Status", state: 0, values: [
        { type_name: "SelectOption", name: "Any",       value: "" },
        { type_name: "SelectOption", name: "Airing",    value: "RELEASING" },
        { type_name: "SelectOption", name: "Finished",  value: "FINISHED" },
        { type_name: "SelectOption", name: "Upcoming",  value: "NOT_YET_RELEASED" },
        { type_name: "SelectOption", name: "Cancelled", value: "CANCELLED" },
        { type_name: "SelectOption", name: "Hiatus",    value: "HIATUS" },
      ]},
      { type_name: "SelectFilter", name: "Season", state: 0, values: [
        { type_name: "SelectOption", name: "Any",    value: "" },
        { type_name: "SelectOption", name: "Winter", value: "WINTER" },
        { type_name: "SelectOption", name: "Spring", value: "SPRING" },
        { type_name: "SelectOption", name: "Summer", value: "SUMMER" },
        { type_name: "SelectOption", name: "Fall",   value: "FALL" },
      ]},
      { type_name: "SelectFilter", name: "Year", state: 0, values: years },
      { type_name: "SelectFilter", name: "Audio", state: 0, values: [
        { type_name: "SelectOption", name: "Any",       value: "" },
        { type_name: "SelectOption", name: "Subbed",    value: "sub" },
        { type_name: "SelectOption", name: "Dubbed",    value: "dub" },
        { type_name: "SelectOption", name: "Sub & Dub", value: "both" },
      ]},
      {
        type_name: "GroupFilter",
        name: "Genres",
        state: genres.map(function (g) {
          return { type_name: "CheckBox", name: g, value: g, state: false };
        }),
      },
    ];
  }

  getSourcePreferences() {
    return [
      {
        key: "oneanime_pref_servers",
        multiSelectListPreference: {
          title: "Servers",
          summary: "Servers listed in the player's picker. ZenV2 and Zen are two mirrors of the same stream, so if one buffers or will not start, switch to the other in the player. A server you untick is only used if the ticked ones fail.",
          values: ["ZenV2", "Zen"],
          entries: ["ZenV2 (fetch8 mirror)", "Zen (fetch9 mirror)"],
          entryValues: ["ZenV2", "Zen"],
        },
      },
      {
        key: "oneanime_pref_server",
        listPreference: {
          title: "Server to play first",
          summary: "The server the player starts with, and the one downloads use. Auto starts with ZenV2.",
          valueIndex: 0,
          entries: ["Auto (ZenV2)", "ZenV2", "Zen"],
          entryValues: ["auto", "ZenV2", "Zen"],
        },
      },
      {
        key: "oneanime_pref_audio",
        listPreference: {
          title: "Preferred audio",
          summary: "Sub and Dub both show up in the player's quality list; this only orders them (Mangayomi plays whichever is first) and, for the -only options, hides episodes missing that version. Every episode's stream carries both audio tracks and every subtitle regardless of which entry you open, so switch tracks for real from the player's own audio menu.",
          valueIndex: 0,
          entries: [
            "Sub then Dub (Sub plays, Dub as backup)",
            "Dub then Sub (Dub plays, Sub as backup)",
            "Sub only",
            "Dub only",
          ],
          entryValues: ["sub_dub", "dub_sub", "sub", "dub"],
        },
      },
      {
        key: "oneanime_pref_ep_thumbnails",
        checkBoxPreference: {
          title: "Episode thumbnails",
          summary: "Show a thumbnail next to each episode in the list.",
          value: true,
        },
      },
    ];
  }
}
