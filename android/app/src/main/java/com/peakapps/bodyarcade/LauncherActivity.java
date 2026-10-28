/*
 * Copyright 2020 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.peakapps.bodyarcade;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.Toast;

// Release 4: Bubblewrap does not regenerate this file any more (build.ps1 is run without -Update; see NOTLAR-release4.md). The launch below is the
// offline-first pattern of developer.chrome.com/docs/android/trusted-web-activity/offline-first. The first time the app is opened with no
// connection the site's service worker does not exist yet, and Chrome would show its network error page. Here the app shows a screen of its own,
// with a "Try again" button, and opens the site as soon as the phone is online. After the site has been opened one time (its service worker is then
// installed and its pages are stored) every launch opens it at once, with or without a connection.
public class LauncherActivity
        extends com.google.androidbrowserhelper.trusted.LauncherActivity {

    private static final String PREFS = "bodyarcade_launch";
    private static final String KEY_OPENED = "site_opened_once";

    /** The first launch found no connection: the offline screen is drawn once the base class has set the window up. */
    private boolean offlineFirstLaunch = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Setting an orientation crashes the app due to the transparent background on Android 8.0
        // Oreo and below. We only set the orientation on Oreo and above. This only affects the
        // splash screen and Chrome will still respect the orientation.
        // See https://github.com/GoogleChromeLabs/bubblewrap/issues/496 for details.
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.O) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        } else {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }
        if (offlineFirstLaunch && !isFinishing()) {
            showOfflineScreen();
        }
    }

    /**
     * True (open the site now) when the site has been opened before, or when there is a connection: the base class then launches the
     * Trusted Web Activity. False only for a first launch with no connection: the offline screen is drawn instead.
     */
    @Override
    protected boolean shouldLaunchImmediately() {
        if (hasOpenedBefore() || isOnline() || isUpdatedInstall()) {
            markOpened();
            return true;
        }
        offlineFirstLaunch = true;
        return false;
    }

    private void showOfflineScreen() {
        setContentView(R.layout.activity_offline_first);
        View retry = findViewById(R.id.offline_retry);
        retry.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                retryOpening();
            }
        });
    }

    private void retryOpening() {
        if (isOnline()) {
            markOpened();
            launchTwa();
        } else {
            Toast.makeText(this, R.string.offline_still, Toast.LENGTH_SHORT).show();
        }
    }

    private boolean isOnline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) {
            // No way to ask: let the site try (Chrome shows its own page when there really is no connection).
            return true;
        }
        Network network = cm.getActiveNetwork();
        if (network == null) {
            return false;
        }
        NetworkCapabilities caps = cm.getNetworkCapabilities(network);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    /**
     * An app that was updated (the closed test's first build, version 2) has been opened before in all likelihood, and its site is stored: it opens
     * at once, as it always did. Only a fresh install with no connection gets the offline screen.
     */
    private boolean isUpdatedInstall() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return info.lastUpdateTime > info.firstInstallTime;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private boolean hasOpenedBefore() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_OPENED, false);
    }

    private void markOpened() {
        SharedPreferences.Editor editor = getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        editor.putBoolean(KEY_OPENED, true);
        editor.apply();
    }

    @Override
    protected Uri getLaunchingUrl() {
        // Get the original launch Url.
        Uri uri = super.getLaunchingUrl();



        return uri;
    }
}
