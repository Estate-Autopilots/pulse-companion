package com.pulse.work.mobile

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

class PulseInstallerModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val executor = Executors.newSingleThreadExecutor()
  override fun getName() = "PulseInstaller"
  @ReactMethod fun canInstall(promise: Promise) { promise.resolve(Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()) }
  @ReactMethod fun openPermission(promise: Promise) {
    try { context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); promise.resolve(null) }
    catch (e: Exception) { promise.reject("permission", "Open Android Settings → Apps → Pulse → Install unknown apps.") }
  }
  @ReactMethod fun download(url: String, sha256: String, size: Double, promise: Promise) {
    executor.execute {
      try {
        val initial = URL(url)
        require(initial.protocol == "https" && initial.host == "github.com" && initial.path.startsWith("/Estate-Autopilots/pulse-companion/releases/download/companion-v") && initial.path.endsWith(".apk"))
        require(sha256.matches(Regex("[a-f0-9]{64}")) && size > 0 && size < 200000000)
        var next = initial
        var connection: HttpURLConnection? = null
        for (i in 0..5) {
          require(next.protocol == "https" && next.host in listOf("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"))
          val c = next.openConnection() as HttpURLConnection
          c.instanceFollowRedirects = false; c.connectTimeout = 30000; c.readTimeout = 30000
          if (c.responseCode in listOf(301,302,303,307,308)) { next = URL(next, c.getHeaderField("Location")); c.disconnect() }
          else { require(c.responseCode == 200); connection = c; break }
        }
        val c = requireNotNull(connection)
        val dir = File(context.cacheDir,"pulse-updates"); dir.mkdirs()
        val file = File(dir,"Pulse-$sha256.apk.part"); val digest = MessageDigest.getInstance("SHA-256"); var bytes = 0L
        try { c.inputStream.use { input -> file.outputStream().use { output -> val buffer = ByteArray(65536); while(true) { val n=input.read(buffer); if(n<0)break; bytes+=n; require(bytes <= size.toLong()); digest.update(buffer,0,n); output.write(buffer,0,n) } } } }
        finally { c.disconnect() }
        require(bytes == size.toLong() && digest.digest().joinToString("") { "%02x".format(it) } == sha256)
        val pm=context.packageManager
        @Suppress("DEPRECATION") val flags=if(Build.VERSION.SDK_INT>=28)PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        @Suppress("DEPRECATION") val candidate=pm.getPackageArchiveInfo(file.path,flags) ?: error("Invalid APK")
        @Suppress("DEPRECATION") val installed=pm.getPackageInfo(context.packageName,flags)
        @Suppress("DEPRECATION") val newer=if(Build.VERSION.SDK_INT>=28)candidate.longVersionCode>installed.longVersionCode else candidate.versionCode>installed.versionCode
        require(candidate.packageName == context.packageName && newer)
        @Suppress("DEPRECATION") val old=(if(Build.VERSION.SDK_INT>=28)installed.signingInfo?.apkContentsSigners else installed.signatures)?.map { it.toCharsString() }?.toSet()
        @Suppress("DEPRECATION") val replacement=(if(Build.VERSION.SDK_INT>=28)candidate.signingInfo?.apkContentsSigners else candidate.signatures)?.map { it.toCharsString() }?.toSet()
        require(!old.isNullOrEmpty() && old == replacement) { "This APK uses a different signing key" }
        val ready=File(dir,"Pulse-$sha256.apk"); require(file.renameTo(ready)); promise.resolve(ready.name)
      } catch(e: Exception) { promise.reject("download", "Pulse could not verify the update. Check your connection; a build with a different signing key cannot replace this app.") }
    }
  }
  @ReactMethod fun install(name: String, promise: Promise) {
    try {
      require(name.matches(Regex("Pulse-[a-f0-9]{64}\\.apk")))
      if(Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) { promise.resolve("permission"); return }
      val file=File(File(context.cacheDir,"pulse-updates"),name); require(file.isFile)
      val uri=FileProvider.getUriForFile(context,"${context.packageName}.pulse.updates",file)
      context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION))
      promise.resolve("installer")
    } catch(e: Exception) { promise.reject("install", "Android could not open the Pulse installer. Try again.") }
  }
}
class PulseInstallerPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(PulseInstallerModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*,*>> = emptyList()
}
