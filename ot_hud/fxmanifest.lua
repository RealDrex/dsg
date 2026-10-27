fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'ot_hud'
description 'OT HUD - compass, player status, weapon, vehicle & aircraft HUD'
version '2.0.0'

shared_scripts {
    'config.lua',
    'shared/weapons.lua',
}

client_scripts {
    'client/main.lua',
    'client/player.lua',
    'client/compass.lua',
    'client/weapon.lua',
    'client/vehicle.lua',
    'client/aircraft.lua',
    'client/stress.lua',
}

server_scripts {
    'server/main.lua',
}

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/fonts.css',
    'html/css/*.css',
    'html/js/*.js',
    'html/assets/fonts/*.woff2',
    'html/assets/sounds/notifications/*.mp3',
    'html/assets/blips/*.png',
    'html/assets/blips/*.gif',
}
