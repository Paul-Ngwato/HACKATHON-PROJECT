package com.baraton.attendsmart.lecturer;

import android.os.Bundle;

import com.baraton.attendsmart.lecturer.host.ClassHostPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ClassHostPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
