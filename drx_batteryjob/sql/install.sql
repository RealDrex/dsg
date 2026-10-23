-- The resource creates this table automatically; this file is a fallback
CREATE TABLE IF NOT EXISTS `drx_batteryjob_stats` (
    `citizenid` VARCHAR(50) NOT NULL,
    `calls` INT NOT NULL DEFAULT 0,
    `earned` INT NOT NULL DEFAULT 0,
    `contracts` INT NOT NULL DEFAULT 0,
    PRIMARY KEY (`citizenid`)
);
