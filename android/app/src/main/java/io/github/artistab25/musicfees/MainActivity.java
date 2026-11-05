package io.github.artistab25.musicfees;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Android 15+ dibuja la app debajo de la barra de estado: Capacitor pasa las zonas seguras a la
        // página (env(safe-area-inset-*) y --safe-area-inset-*) y el CSS deja libre la parte de arriba.
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
