CREATE TABLE users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  mobile VARCHAR(15) NOT NULL,
  role ENUM('CUSTOMER','PROVIDER','ADMIN','SUPER_ADMIN') NOT NULL,
  status ENUM('ACTIVE','PENDING','BLOCKED','REJECTED','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE addresses (
  address_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  address_line VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(10),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE destinations (
  destination_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  country VARCHAR(100) NOT NULL DEFAULT 'India',
  description TEXT,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  UNIQUE (name, city)
);

CREATE TABLE categories (
  category_id INT AUTO_INCREMENT PRIMARY KEY,
  category_name VARCHAR(80) NOT NULL UNIQUE,
  description TEXT,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE tour_packages (
  package_id INT AUTO_INCREMENT PRIMARY KEY,
  provider_id INT NOT NULL,
  destination_id INT NOT NULL,
  category_id INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  inclusions TEXT, -- ADDED: one item per line
  exclusions TEXT, -- ADDED: one item per line
  duration_days INT NOT NULL CHECK (duration_days > 0),
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0), -- price per traveler
  capacity INT NOT NULL CHECK (capacity > 0), -- default seats per date
  image VARCHAR(255),
  status ENUM('PENDING','APPROVED','REJECTED','DISABLED') NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_id) REFERENCES users(user_id),
  FOREIGN KEY (destination_id) REFERENCES destinations(destination_id),
  FOREIGN KEY (category_id) REFERENCES categories(category_id)
);

CREATE TABLE package_itinerary (
  itinerary_id INT AUTO_INCREMENT PRIMARY KEY,
  package_id INT NOT NULL,
  day_no INT NOT NULL CHECK (day_no > 0),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  UNIQUE (package_id, day_no),
  FOREIGN KEY (package_id) REFERENCES tour_packages(package_id) ON DELETE CASCADE
);

CREATE TABLE package_availability (
  availability_id INT AUTO_INCREMENT PRIMARY KEY,
  package_id INT NOT NULL,
  available_date DATE NOT NULL,
  seats_available INT NOT NULL CHECK (seats_available >= 0),
  status ENUM('OPEN','CLOSED','FULL') NOT NULL DEFAULT 'OPEN',
  UNIQUE (package_id, available_date),
  FOREIGN KEY (package_id) REFERENCES tour_packages(package_id) ON DELETE CASCADE
);

CREATE TABLE bookings (
  booking_id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  package_id INT NOT NULL,
  availability_id INT NOT NULL,
  travelers INT NOT NULL CHECK (travelers > 0),
  total_amount DECIMAL(10,2) NOT NULL,
  booking_status ENUM('PENDING','CONFIRMED','CANCELLED','COMPLETED') NOT NULL DEFAULT 'PENDING',
  payment_status ENUM('UNPAID','PAID','REFUNDED') NOT NULL DEFAULT 'UNPAID',
  booked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(user_id),
  FOREIGN KEY (package_id) REFERENCES tour_packages(package_id),
  FOREIGN KEY (availability_id) REFERENCES package_availability(availability_id)
);

CREATE TABLE payments (
  payment_id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL UNIQUE, -- one booking, one payment
  customer_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_method ENUM('UPI','CARD','NETBANKING','CASH') NOT NULL,
  payment_status ENUM('SUCCESS','FAILED','REFUNDED') NOT NULL,
  paid_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id),
  FOREIGN KEY (customer_id) REFERENCES users(user_id)
);

CREATE TABLE reviews (
  review_id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL UNIQUE, -- one booking, one review
  customer_id INT NOT NULL,
  package_id INT NOT NULL,
  rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id),
  FOREIGN KEY (customer_id) REFERENCES users(user_id),
  FOREIGN KEY (package_id) REFERENCES tour_packages(package_id)
);

CREATE TABLE admin_permissions (
  permission_id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  permission_name VARCHAR(50) NOT NULL,
  UNIQUE (admin_id, permission_name),
  FOREIGN KEY (admin_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE system_logs (
  log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(60) NOT NULL,
  description VARCHAR(500),
  ip_address VARCHAR(45),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (created_at),
  INDEX (action),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE system_settings ( -- ADDED for Super Admin settings
  setting_key VARCHAR(60) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
