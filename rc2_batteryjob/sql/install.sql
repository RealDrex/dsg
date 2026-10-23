-- السكربت ينشئ الجدول تلقائياً، هذا الملف للاحتياط
CREATE TABLE IF NOT EXISTS `rc2_batteryjob_stats` (
    `citizenid` VARCHAR(50) NOT NULL,
    `calls` INT NOT NULL DEFAULT 0,
    `earned` INT NOT NULL DEFAULT 0,
    `contracts` INT NOT NULL DEFAULT 0,
    PRIMARY KEY (`citizenid`)
);
