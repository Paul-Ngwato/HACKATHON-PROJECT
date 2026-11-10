package com.baraton.attendsmart.student;

import android.os.Bundle;

import com.baraton.attendsmart.student.host.ClassFinderPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ClassFinderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
