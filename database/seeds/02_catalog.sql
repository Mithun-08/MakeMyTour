-- =============================================================
-- seeds/02_catalog.sql   Owner: M3
-- Catalog seed data: destinations, categories, packages,
-- itineraries, availability.
--
-- Re-runnable: uses INSERT IGNORE (destinations, categories,
-- package_itinerary, package_availability) and INSERT … ON
-- DUPLICATE KEY UPDATE (tour_packages) so running this file
-- again on an existing database is safe.
--
-- Fixed ID contract (do NOT change these IDs; they are
-- referenced by 03_bookings.sql and by the API test checklist):
--   destinations : 1 – 6
--   categories   : 1 – 5
--   packages     : 1 – 10  (8 APPROVED, 1 PENDING, 1 DISABLED)
--   providers    : 4 (Ravi Kumar), 5 (Meena Iyer)  [from setup.js]
-- =============================================================

-- -------------------------------------------------------
-- 1. DESTINATIONS  (6 rows)
-- -------------------------------------------------------
INSERT IGNORE INTO destinations
  (destination_id, name, city, state, country, description, status)
VALUES
  (1,  'Munnar Hill Station',        'Munnar',      'Kerala',          'India',
   'Scenic hill station famous for tea gardens, misty mountains and waterfalls.',
   'ACTIVE'),

  (2,  'Hampi Ruins',                'Hampi',       'Karnataka',       'India',
   'UNESCO World Heritage Site with ancient Vijayanagara Empire ruins.',
   'ACTIVE'),

  (3,  'Jaisalmer Desert',           'Jaisalmer',   'Rajasthan',       'India',
   'Golden city in the Thar Desert, known for sand dunes, camel safaris and forts.',
   'ACTIVE'),

  (4,  'Andaman Islands',            'Port Blair',  'Andaman & Nicobar','India',
   'Tropical archipelago with pristine beaches, coral reefs and turquoise waters.',
   'ACTIVE'),

  (5,  'Coorg Coffee Trails',        'Madikeri',    'Karnataka',       'India',
   'Lush coffee and spice plantations set amid misty Western Ghats hills.',
   'ACTIVE'),

  (6,  'Spiti Valley Expedition',    'Kaza',        'Himachal Pradesh','India',
   'Remote cold-desert mountain valley with Buddhist monasteries and high passes.',
   'ACTIVE');

-- -------------------------------------------------------
-- 2. CATEGORIES  (5 rows)
-- -------------------------------------------------------
INSERT IGNORE INTO categories
  (category_id, category_name, description, status)
VALUES
  (1, 'Adventure',     'Trekking, rafting, camping and other outdoor thrills.', 'ACTIVE'),
  (2, 'Cultural',      'History, heritage sites, temples and local art.',         'ACTIVE'),
  (3, 'Beach & Island','Sea, sand, snorkelling and island hopping.',              'ACTIVE'),
  (4, 'Wildlife',      'National parks, safaris and bird watching.',              'ACTIVE'),
  (5, 'Leisure',       'Relaxed sightseeing, hill stations and wellness stays.',  'ACTIVE');

-- -------------------------------------------------------
-- 3. TOUR PACKAGES  (10 rows)
--    provider 4 = Ravi Kumar  (packages 1-5, 10)
--    provider 5 = Meena Iyer  (packages 6-9)
--    statuses: APPROVED(1-8), PENDING(9), DISABLED(10)
-- -------------------------------------------------------
INSERT INTO tour_packages
  (package_id, provider_id, destination_id, category_id,
   title, description,
   inclusions, exclusions,
   duration_days, price, capacity, image, status)
VALUES
  -- Package 1: Munnar / Leisure / Ravi Kumar  APPROVED
  (1, 4, 1, 5,
   'Munnar Misty Escape',
   'A rejuvenating 4-day break through Munnar''s tea estates, viewpoints and waterfalls. Ideal for couples and families seeking cool mountain air and scenic beauty.',
   'Hotel accommodation (3 nights)\nBreakfast and dinner daily\nAC vehicle transfers\nTea estate guided walk\nEravikulam National Park entry\nTourism taxes',
   'Airfare\nLunch\nPersonal expenses\nAlcohol',
   4, 8500.00, 20, 'images/munnar-leisure.jpg', 'APPROVED'),

  -- Package 2: Munnar / Adventure / Ravi Kumar  APPROVED
  (2, 4, 1, 1,
   'Munnar Trek and Camp',
   'Two days of guided high-altitude trekking followed by a night under the stars at a campsite above 6 000 ft. Includes Meesapulimala trek.',
   'Tent accommodation (2 nights)\nAll meals at camp\nProfessional trek guide\nSafety equipment\nFirst-aid support',
   'Personal trekking gear\nSleeping bag\nAirfare\nTravel insurance',
   3, 5200.00, 12, 'images/munnar-trek.jpg', 'APPROVED'),

  -- Package 3: Hampi / Cultural / Ravi Kumar  APPROVED
  (3, 4, 2, 2,
   'Hampi Heritage Explorer',
   'Walk through the ruins of a once-magnificent empire. This 3-day package covers the royal enclosure, Virupaksha temple, Vittala temple and a sunset coracle ride.',
   'Budget guesthouse (2 nights)\nBreakfast daily\nLicensed heritage guide\nCoracle ride\nMap and audio guide',
   'Lunch and dinner\nMonument entry fees\nTransport to Hampi',
   3, 4200.00, 18, 'images/hampi-cultural.jpg', 'APPROVED'),

  -- Package 4: Jaisalmer / Adventure / Ravi Kumar  APPROVED
  (4, 4, 3, 1,
   'Jaisalmer Desert Adventure',
   'Experience the Thar Desert at its most dramatic: camel safari at dusk, overnight camping in the dunes, jeep safari at sunrise and a fort tour on the final day.',
   'Swiss tent accommodation (2 nights)\nAll meals\nCamel safari (2 hrs)\nJeep safari\nCultural folk performance\nFort tour',
   'Airfare / train fare\nAlcohol\nPersonal shopping',
   3, 7800.00, 16, 'images/jaisalmer-adventure.jpg', 'APPROVED'),

  -- Package 5: Coorg / Leisure / Ravi Kumar  APPROVED
  (5, 4, 5, 5,
   'Coorg Coffee and Spice Retreat',
   'Unwind for 3 days on a working coffee estate in Coorg. Includes a plantation walk, spice garden tour, cooking class and a visit to Abbey Falls.',
   'Estate bungalow (2 nights)\nBreakfast and dinner\nPlantation guided walk\nSpice garden tour\nCooking class\nFalls visit',
   'Airfare\nLunch\nPersonal purchases from estate shop',
   3, 6500.00, 10, 'images/coorg-leisure.jpg', 'APPROVED'),

  -- Package 6: Andaman / Beach & Island / Meena Iyer  APPROVED
  (6, 5, 4, 3,
   'Andaman Island Hopper',
   'Explore Port Blair, Havelock and Neil Islands over 5 days. Snorkelling at Elephant Beach, sea-walk at North Bay, kayaking in mangroves and a sunset at Radhanagar Beach.',
   'Beach resort accommodation (4 nights)\nBreakfast and dinner\nFerry tickets (inter-island)\nSnorkelling gear\nSea-walk activity\nKayaking (1 hr)',
   'Airfare\nLunch\nScuba diving (chargeable extra)\nPersonal expenses',
   5, 18500.00, 14, 'images/andaman-island.jpg', 'APPROVED'),

  -- Package 7: Andaman / Adventure / Meena Iyer  APPROVED
  (7, 5, 4, 1,
   'Andaman Scuba and Snorkel',
   'A 4-day diving-focused trip for beginners and certified divers. Includes 2 scuba dives, unlimited snorkelling, a glass-bottom boat tour and Cellular Jail light-and-sound show.',
   'Beach resort accommodation (3 nights)\nBreakfast daily\nBeginner scuba (2 dives, PADI instructor)\nSnorkelling unlimited\nGlass-bottom boat ride\nCellular Jail entry',
   'Airfare\nLunch and dinner\nAdvanced dive certification course',
   4, 22000.00, 10, 'images/andaman-scuba.jpg', 'APPROVED'),

  -- Package 8: Spiti / Adventure / Meena Iyer  APPROVED
  (8, 5, 6, 1,
   'Spiti Valley High Altitude Trek',
   'Seven days in the cold desert of Spiti, crossing three high-altitude passes, visiting Key Monastery and Chandratal Lake. Suitable for experienced trekkers only.',
   'Guesthouse and camping (6 nights)\nAll meals\nExperienced high-altitude guide\nPorter support\nCampfire evenings\nFirst-aid oxygen cylinder',
   'Personal trekking gear\nSleeping bag\nFlight to Chandigarh\nTravel insurance (mandatory)',
   7, 14500.00, 8, 'images/spiti-trek.jpg', 'APPROVED'),

  -- Package 9: Coorg / Wildlife  PENDING (awaiting admin approval)
  (9, 5, 5, 4,
   'Coorg Wildlife Safari',
   'Two-day safari around Nagarhole National Park and Dubare Elephant Camp. Spot leopards, elephants, gaur and over 270 bird species. PENDING admin approval — not yet publicly visible.',
   'Forest lodge (1 night)\nAll meals\nJeep safari (2 rides)\nElephant camp visit\nNaturalist guide',
   'Airfare\nPersonal expenses\nAlcohol',
   2, 5800.00, 12, 'images/coorg-wildlife.jpg', 'PENDING'),

  -- Package 10: Hampi / Cultural  DISABLED by provider
  (10, 4, 2, 2,
   'Hampi Photography Walk',
   'A niche photography-focused half-day walk through Hampi''s ruins at golden hour. Currently disabled by the provider and not visible to customers.',
   'Photography guide\nTransport within Hampi\nLight snacks',
   'Camera gear\nFull meals\nAccommodation',
   1, 1800.00, 8, 'images/hampi-photo.jpg', 'DISABLED')

ON DUPLICATE KEY UPDATE
  title            = VALUES(title),
  description      = VALUES(description),
  inclusions       = VALUES(inclusions),
  exclusions       = VALUES(exclusions),
  duration_days    = VALUES(duration_days),
  price            = VALUES(price),
  capacity         = VALUES(capacity),
  image            = VALUES(image);
  -- NOTE: `status` is intentionally excluded from this UPDATE clause.
  -- Including it would silently reset any admin-moderated status (APPROVED /
  -- REJECTED / DISABLED set by an admin after initial seeding) back to the
  -- seed value on every re-run of setup.js.  Content fields (title, price,
  -- etc.) are safe to refresh; moderation state must not be overwritten.

-- -------------------------------------------------------
-- 4. PACKAGE ITINERARY
--    3–5 days per package; INSERT IGNORE (safe to re-run).
-- -------------------------------------------------------

-- ---- Package 1: Munnar Misty Escape (4 days) ----
INSERT IGNORE INTO package_itinerary (package_id, day_no, title, description) VALUES
  (1,1,'Arrival and Tea Estate Walk',
    'Arrive in Munnar, check in, and join a late-afternoon guided walk through Top Station tea estates. Welcome dinner at the hotel.'),
  (1,2,'Eravikulam National Park',
    'Full-day visit to spot the endangered Nilgiri Tahr. Afternoon at Kundala Lake and Mattupetty Dam viewpoint.'),
  (1,3,'Waterfalls and Viewpoints',
    'Visit Attukal Falls, Photo Point, Echo Point and Lock Heart Gap. Evening at leisure in the town market.'),
  (1,4,'Departure Morning',
    'Breakfast, hotel check-out. Optional morning visit to the Tata Tea Museum before departure transfer.');

-- ---- Package 2: Munnar Trek and Camp (3 days) ----
INSERT IGNORE INTO package_itinerary (package_id, day_no, title, description) VALUES
  (2,1,'Basecamp Orientation and Easy Trail',
    'Arrive at campsite, equipment briefing, practice walk on lower trail. Campfire dinner.'),
  (2,2,'Meesapulimala Summit Trek',
    'Early start for the full Meesapulimala ridge trek (return). Packed lunch on trail, sunset views at top.'),
  (2,3,'Morning Nature Walk and Departure',
    'Dawn bird-watching walk, breakfast, pack camp and transfer to Munnar town.');

-- ---- Package 3: Hampi Heritage Explorer (3 days) ----
INSERT IGNORE INTO package_itinerary (package_id, day_no, title, description) VALUES
  (3,1,'Royal Enclosure and Zanana Baths',
    'Morning guided walk through the royal enclosure, Lotus Mahal, elephant stables and Zanana Baths. Afternoon rest.'),
  (3,2,'Vittala Temple and Coracle Ride',
    'Visit the iconic Stone Chariot and Musical Pillars at Vittala Temple. Evening coracle ride on the Tungabhadra.'),
  (3,3,'Virupaksha Temple and Departure',
    'Morning puja at the living temple, riverside stroll, and checkout transfer to Hospet station.');

-- ---- Package 4: Jaisalmer Desert Adventure (3 days) ----
INSERT IGNORE INTO package_itinerary (package_id, day_no, title, description) VALUES
  (4,1,'Arrival and Dune Camp Setup',
    'Arrive Jaisalmer, transfer to Sam Sand Dunes camp. Camel safari at sunset, folk dance and dinner under the stars.'),
  (4,2,'Sunrise Jeep Safari and Fort Tour',
    'Jeep safari across the dunes at dawn. Afternoon guided tour of Jaisalmer Fort, Patwon Ki Haveli and Gadisar Lake.'),
  (4,3,'Cultural Village Walk and Departure',
    'Morning walk through a local Bishnoi village. Shopping at Sadar Bazar, check-out and transfer to station.');

-- ---- Package 5: Coorg Coffee and Spice Retreat (3 days) ----
INSERT IGNORE INTO package_itinerary (package_id, day_no, title, description) VALUES
  (5,1,'Estate Arrival and Plantation Walk',
    'Arrive at the coffee estate, settle in, guided walk through coffee and pepper rows, evening bonfire.'),
  (5,2,'Spice Garden, Cooking Class and Abbey Falls',
    'Morning spice garden tour (cardamom, vanilla, pepper). Hands-on Coorgi cooking class. Post-lunch visit to Abbey Falls.'),
  (5,3,'Estate Breakfast and Departure',
    'Leisurely estate breakfast, estate shop visit, check-out and transfer to Madikeri bus stand.');

-- ---- Package 6: Andaman Island Hopper (5 days) ----
INSERT IGNORE INTO package_itinerary (package_id, day_no, title, description) VALUES
  (6,1,'Port Blair Arrival and Cellular Jail',
    'Arrive Port Blair, check in. Evening at Cellular Jail for the light-and-sound show.'),
  (6,2,'North Bay and Ross Island',
    'Morning sea-walk at North Bay Coral Reef. Afternoon boat ride to Ross Island ruins.'),
  (6,3,'Ferry to Havelock – Radhanagar Beach',
    'Morning ferry to Havelock. Afternoon at Radhanagar Beach (Asia''s top-rated beach). Sunset kayaking.'),
  (6,4,'Elephant Beach Snorkelling',
    'Snorkelling at Elephant Beach (boat access). Afternoon free at Vijaynagar beach.'),
  (6,5,'Neil Island Day Trip and Departure',
    'Day trip to Neil Island – Natural Bridge and Bharatpur Beach. Evening ferry back to Port Blair for departure.');

-- ---- Package 7: Andaman Scuba and Snorkel (4 days) ----
INSERT IGNORE INTO package_itinerary (package_id, day_no, title, description) VALUES
  (7,1,'Arrival, Briefing and Snorkelling Intro',
    'Arrive Port Blair, equipment fitting, pool orientation session, evening snorkel at North Bay.'),
  (7,2,'First Scuba Dive – Beginner Session',
    'Briefing at dive centre, first confined-water dive, then open-water dive at Aquarium Reef (6–8 m). Debrief.'),
  (7,3,'Second Scuba Dive and Glass-Bottom Boat',
    'Morning open-water dive at Mac Point. Afternoon glass-bottom boat tour over the coral gardens.'),
  (7,4,'Havelock Snorkel and Departure',
    'Day trip to Elephant Beach for unlimited free snorkelling. Return to Port Blair for departure flight.');

-- ---- Package 8: Spiti Valley High Altitude Trek (7 days) ----
INSERT IGNORE INTO package_itinerary (package_id, day_no, title, description) VALUES
  (8,1,'Acclimatisation at Kaza',
    'Arrive Kaza by road from Shimla. Rest day, light village walk, acclimatisation briefing.'),
  (8,2,'Key Monastery and Kibber Village',
    'Half-day at Key Monastery (4 166 m). Walk to Kibber, the world''s highest motorable village.'),
  (8,3,'Kanamo Peak Trek',
    'Full-day trek to Kanamo Peak (5 974 m). Panoramic views of Spiti valley and surrounding ranges.'),
  (8,4,'Langza Fossil Village',
    'Trek to Langza, known for marine fossils and a giant Buddha statue overlooking the valley.'),
  (8,5,'Chandratal Lake Hike',
    'Drive to Batal, hike to Chandratal (Moon Lake). Overnight camp beside the turquoise glacial lake.'),
  (8,6,'Kunzum Pass and Descent',
    'Cross Kunzum Pass (4 551 m), drive along Chandra River. Final camp at Gramphu.'),
  (8,7,'Return to Manali and Departure',
    'Scenic drive through Rohtang Pass to Manali. Drop at Manali bus stand / Bhuntar airport.');

-- ---- Package 9: Coorg Wildlife Safari (2 days) — PENDING ----
INSERT IGNORE INTO package_itinerary (package_id, day_no, title, description) VALUES
  (9,1,'Nagarhole Jeep Safari',
    'Morning and afternoon jeep safaris inside Nagarhole National Park. Naturalist-guided wildlife spotting.'),
  (9,2,'Dubare Elephant Camp and Departure',
    'Early visit to Dubare for elephant bathing experience, breakfast, checkout and transfer to Madikeri.');

-- ---- Package 10: Hampi Photography Walk (1 day) — DISABLED ----
INSERT IGNORE INTO package_itinerary (package_id, day_no, title, description) VALUES
  (10,1,'Golden Hour Photography Walk',
    'Pre-dawn start at Hemakuta Hill, shoot at Vittala, Virupaksha and the Royal Enclosure during golden hour. Professional photo tips included.');

-- -------------------------------------------------------
-- 5. PACKAGE AVAILABILITY
--    ≥ 4 dates per package using DATE_ADD(CURDATE(), ...)
--    so data never goes stale.
--    availability_id range: 1 – 48  (see per-package blocks)
--    INSERT IGNORE: safe to re-run inside a full db:setup.
--
--    WARNING — do NOT run this file standalone against an
--    existing database without a prior DROP/recreate.
--    Because available_date = DATE_ADD(CURDATE(), INTERVAL n DAY)
--    changes every calendar day, running on a new day inserts
--    fresh rows (different date → different unique key) while
--    leaving the previous day's rows intact.  This results in
--    stale availability rows that accumulate over time.
--    These seeds are designed exclusively for use inside
--    setup.js, which drops and recreates all tables first.
-- -------------------------------------------------------

-- Package 1 – Munnar Misty Escape (availability_ids 1–5)
INSERT IGNORE INTO package_availability
  (availability_id, package_id, available_date, seats_available, status)
VALUES
  ( 1, 1, DATE_ADD(CURDATE(), INTERVAL  7 DAY), 20, 'OPEN'),
  ( 2, 1, DATE_ADD(CURDATE(), INTERVAL 14 DAY), 20, 'OPEN'),
  ( 3, 1, DATE_ADD(CURDATE(), INTERVAL 21 DAY), 15, 'OPEN'),
  ( 4, 1, DATE_ADD(CURDATE(), INTERVAL 28 DAY), 20, 'OPEN'),
  ( 5, 1, DATE_ADD(CURDATE(), INTERVAL 35 DAY), 20, 'OPEN');

-- Package 2 – Munnar Trek and Camp (availability_ids 6–10)
INSERT IGNORE INTO package_availability
  (availability_id, package_id, available_date, seats_available, status)
VALUES
  ( 6, 2, DATE_ADD(CURDATE(), INTERVAL  5 DAY), 12, 'OPEN'),
  ( 7, 2, DATE_ADD(CURDATE(), INTERVAL 12 DAY), 12, 'OPEN'),
  ( 8, 2, DATE_ADD(CURDATE(), INTERVAL 19 DAY),  8, 'OPEN'),
  ( 9, 2, DATE_ADD(CURDATE(), INTERVAL 26 DAY), 12, 'OPEN'),
  (10, 2, DATE_ADD(CURDATE(), INTERVAL 33 DAY), 12, 'OPEN');

-- Package 3 – Hampi Heritage Explorer (availability_ids 11–15)
INSERT IGNORE INTO package_availability
  (availability_id, package_id, available_date, seats_available, status)
VALUES
  (11, 3, DATE_ADD(CURDATE(), INTERVAL  6 DAY), 18, 'OPEN'),
  (12, 3, DATE_ADD(CURDATE(), INTERVAL 13 DAY), 18, 'OPEN'),
  (13, 3, DATE_ADD(CURDATE(), INTERVAL 20 DAY), 10, 'OPEN'),
  (14, 3, DATE_ADD(CURDATE(), INTERVAL 27 DAY), 18, 'OPEN'),
  (15, 3, DATE_ADD(CURDATE(), INTERVAL 34 DAY), 18, 'OPEN');

-- Package 4 – Jaisalmer Desert Adventure (availability_ids 16–20)
INSERT IGNORE INTO package_availability
  (availability_id, package_id, available_date, seats_available, status)
VALUES
  (16, 4, DATE_ADD(CURDATE(), INTERVAL  8 DAY), 16, 'OPEN'),
  (17, 4, DATE_ADD(CURDATE(), INTERVAL 15 DAY), 16, 'OPEN'),
  (18, 4, DATE_ADD(CURDATE(), INTERVAL 22 DAY),  0, 'FULL'),
  (19, 4, DATE_ADD(CURDATE(), INTERVAL 29 DAY), 16, 'OPEN'),
  (20, 4, DATE_ADD(CURDATE(), INTERVAL 36 DAY), 16, 'OPEN');

-- Package 5 – Coorg Coffee and Spice Retreat (availability_ids 21–25)
INSERT IGNORE INTO package_availability
  (availability_id, package_id, available_date, seats_available, status)
VALUES
  (21, 5, DATE_ADD(CURDATE(), INTERVAL  9 DAY), 10, 'OPEN'),
  (22, 5, DATE_ADD(CURDATE(), INTERVAL 16 DAY), 10, 'OPEN'),
  (23, 5, DATE_ADD(CURDATE(), INTERVAL 23 DAY),  5, 'OPEN'),
  (24, 5, DATE_ADD(CURDATE(), INTERVAL 30 DAY), 10, 'OPEN'),
  (25, 5, DATE_ADD(CURDATE(), INTERVAL 37 DAY), 10, 'CLOSED');

-- Package 6 – Andaman Island Hopper (availability_ids 26–30)
INSERT IGNORE INTO package_availability
  (availability_id, package_id, available_date, seats_available, status)
VALUES
  (26, 6, DATE_ADD(CURDATE(), INTERVAL 10 DAY), 14, 'OPEN'),
  (27, 6, DATE_ADD(CURDATE(), INTERVAL 17 DAY), 14, 'OPEN'),
  (28, 6, DATE_ADD(CURDATE(), INTERVAL 24 DAY), 14, 'OPEN'),
  (29, 6, DATE_ADD(CURDATE(), INTERVAL 31 DAY),  6, 'OPEN'),
  (30, 6, DATE_ADD(CURDATE(), INTERVAL 38 DAY), 14, 'OPEN');

-- Package 7 – Andaman Scuba and Snorkel (availability_ids 31–35)
INSERT IGNORE INTO package_availability
  (availability_id, package_id, available_date, seats_available, status)
VALUES
  (31, 7, DATE_ADD(CURDATE(), INTERVAL 11 DAY), 10, 'OPEN'),
  (32, 7, DATE_ADD(CURDATE(), INTERVAL 18 DAY), 10, 'OPEN'),
  (33, 7, DATE_ADD(CURDATE(), INTERVAL 25 DAY),  0, 'FULL'),
  (34, 7, DATE_ADD(CURDATE(), INTERVAL 32 DAY), 10, 'OPEN'),
  (35, 7, DATE_ADD(CURDATE(), INTERVAL 39 DAY), 10, 'OPEN');

-- Package 8 – Spiti Valley High Altitude Trek (availability_ids 36–40)
INSERT IGNORE INTO package_availability
  (availability_id, package_id, available_date, seats_available, status)
VALUES
  (36, 8, DATE_ADD(CURDATE(), INTERVAL 14 DAY),  8, 'OPEN'),
  (37, 8, DATE_ADD(CURDATE(), INTERVAL 28 DAY),  8, 'OPEN'),
  (38, 8, DATE_ADD(CURDATE(), INTERVAL 42 DAY),  4, 'OPEN'),
  (39, 8, DATE_ADD(CURDATE(), INTERVAL 56 DAY),  8, 'OPEN'),
  (40, 8, DATE_ADD(CURDATE(), INTERVAL 70 DAY),  8, 'OPEN');

-- Package 9 – Coorg Wildlife Safari PENDING (availability_ids 41–44)
INSERT IGNORE INTO package_availability
  (availability_id, package_id, available_date, seats_available, status)
VALUES
  (41, 9, DATE_ADD(CURDATE(), INTERVAL 15 DAY), 12, 'OPEN'),
  (42, 9, DATE_ADD(CURDATE(), INTERVAL 22 DAY), 12, 'OPEN'),
  (43, 9, DATE_ADD(CURDATE(), INTERVAL 29 DAY), 12, 'OPEN'),
  (44, 9, DATE_ADD(CURDATE(), INTERVAL 36 DAY), 12, 'OPEN');

-- Package 10 – Hampi Photography Walk DISABLED (availability_ids 45–48)
INSERT IGNORE INTO package_availability
  (availability_id, package_id, available_date, seats_available, status)
VALUES
  (45,10, DATE_ADD(CURDATE(), INTERVAL 10 DAY),  8, 'OPEN'),
  (46,10, DATE_ADD(CURDATE(), INTERVAL 17 DAY),  8, 'OPEN'),
  (47,10, DATE_ADD(CURDATE(), INTERVAL 24 DAY),  8, 'OPEN'),
  (48,10, DATE_ADD(CURDATE(), INTERVAL 31 DAY),  8, 'OPEN');

-- End of 02_catalog.sql
