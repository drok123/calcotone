import type { SignalLabState } from '../../audio/SignalLab';
import type { ModuleState, XYAssignment } from '../../ui/types';
import { AsciiArtEngine } from '../ascii/AsciiArtEngine';

export function XYSignalField({ modules, assignments, position, dragging, signalLab }: {
  modules: ModuleState[];
  assignments: XYAssignment[];
  position: { x: number; y: number };
  dragging: boolean;
  signalLab?: SignalLabState;
}) {
  return (
    <div className="xy-visual-stack ascii-only">
      <AsciiArtEngine
        kind="landscape"
        modules={modules}
        position={position}
        dragging={dragging}
        pressure={signalLab}
        patchCount={assignments.length}
        className="xy-signal-field"
      />
    </div>
  );
}
