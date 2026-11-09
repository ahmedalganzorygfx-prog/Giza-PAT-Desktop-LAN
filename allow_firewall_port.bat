@echo off
netsh advfirewall firewall add rule name="Giza PAT Central Service TCP 8765" dir=in action=allow protocol=TCP localport=8765 profile=private
if %errorlevel%==0 (echo تم فتح المنفذ 8765 لشبكة Private فقط.) else (echo فشل إنشاء القاعدة. شغّل الملف كمسؤول.)
pause
