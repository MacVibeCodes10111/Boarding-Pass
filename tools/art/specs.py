# Measurements (metres, approximate) for the aircraft drawn from scratch.
# x runs aft from the nose; y up from the bottom of the fuselage.


def jet_windows(a, b, pitch=0.53, skip=(), y=0.56, w=0.24, h=0.34):
    return dict(**{'from': a, 'to': b}, pitch=pitch, skip=list(skip), y=y, w=w, h=h)


S = {}

# --- Airbus A220 ----------------------------------------------------------
def a220(L, wing_x, windows_to, exits):
    return dict(L=L, D=3.7, nose=7.2, cone=9.0, nose_tip=0.36, upsweep=0.58, tail_end=0.82,
                fin_x=L - 8.6, fin_c=6.2, fin_h=6.4, fin_sweep=0.95, fin_tip_c=0.42,
                windows=jet_windows(5.6, windows_to, 0.86, skip=exits, w=0.30, h=0.42),
                doors=[(3.3, 0.82, 1.85), (L - 8.5, 0.82, 1.85)] + [(a - 0.05, 0.55, 1.0, 0.75) for a, b in exits],
                wing_x=wing_x, wing_c=5.6, span_vis=12.5, dihedral=0.7, winglet=False, stab_x=L - 6.0, stab_c=3.0, stab_y=0.62,
                engines=[dict(kind='fan', x=wing_x - 2.4, y=-0.35, l=4.6, d=2.15)])


S['a220-100'] = a220(35.0, 13.6, 27.5, [(14.6, 15.4)])
S['a220-300'] = a220(38.7, 15.4, 31.0, [(15.9, 16.7), (17.0, 17.8)])

# --- COMAC ----------------------------------------------------------------
C909 = dict(L=33.5, D=3.3, nose=6.2, cone=8.5, nose_tip=0.36, upsweep=0.66, tail_end=0.84,
            fin_x=33.5 - 8.0, fin_c=5.2, fin_h=5.4, fin_sweep=1.0, fin_tip_c=0.75, t_tail=True, stab_c=2.8,
            windows=jet_windows(4.8, 25.0, 0.62, skip=[(13.7, 14.6)], w=0.26, h=0.36),
            doors=[(3.0, 0.82, 1.83), (24.8, 0.82, 1.83), (13.8, 0.55, 1.0, 0.7)],
            wing_x=12.8, wing_c=5.0, span_vis=11.0, dihedral=0.6, winglet=True,
            engines=[dict(kind='fan', x=22.0, y=2.15, l=4.2, d=1.45, rear=True)])
S['comac-c909'] = C909
S['comac-c909ccf'] = dict(C909, windows=None, doors=[(3.0, 0.82, 1.83), (5.2, 3.0, 1.95, 0.85), (24.8, 0.82, 1.83)])
C919 = dict(L=38.9, D=4.0, nose=7.4, cone=9.6, nose_tip=0.35, upsweep=0.58, tail_end=0.8,
            fin_x=38.9 - 9.0, fin_c=6.4, fin_h=6.8, fin_sweep=0.92, fin_tip_c=0.38,
            windows=jet_windows(5.4, 31.6, 0.56, skip=[(15.4, 16.6)], w=0.26, h=0.36),
            doors=[(3.3, 0.82, 1.85), (31.9, 0.82, 1.85), (15.5, 0.5, 1.0, 0.75), (16.0, 0.5, 1.0, 0.75)],
            wing_x=14.8, wing_c=6.0, span_vis=13.5, dihedral=0.7, winglet=True, stab_x=38.9 - 6.2, stab_c=3.2, stab_y=0.62,
            engines=[dict(kind='fan', x=12.4, y=-0.45, l=4.4, d=2.25)])
S['comac-c919'] = C919
S['comac-c919-std'] = C919
S['mc-21-310'] = dict(C919, L=42.3, nose=7.6, cone=10.0, fin_x=42.3 - 9.4, fin_h=7.2,
                      windows=jet_windows(5.6, 34.8, 0.56, skip=[(16.6, 17.8)], w=0.27, h=0.38),
                      doors=[(3.4, 0.82, 1.85), (35.1, 0.82, 1.85), (16.7, 0.5, 1.0, 0.75), (17.2, 0.5, 1.0, 0.75)],
                      wing_x=16.0, wing_c=6.4, span_vis=14.0, stab_x=42.3 - 6.4, winglet=False,
                      engines=[dict(kind='fan', x=13.4, y=-0.5, l=4.6, d=2.3)])

# --- high-wing turboprops and freighters -----------------------------------
def round_windows(a, b, pitch, skip=(), d=0.38, y=0.56):
    return dict(**{'from': a, 'to': b}, pitch=pitch, skip=list(skip), y=y, w=d, h=d, round=True)


S['an-24rv'] = dict(L=23.5, D=2.9, nose=4.6, cone=6.8, nose_tip=0.34, upsweep=0.60, tail_end=0.78, cockpit='glazed',
                    fin_x=23.5 - 6.3, fin_c=4.6, fin_h=4.4, fin_sweep=0.72, fin_tip_c=0.4, dorsal=1.4,
                    windows=round_windows(5.4, 17.0, 1.0, d=0.42), doors=[(17.3, 0.75, 1.4), (3.4, 0.6, 1.1)],
                    high_wing=True, wing_x=8.6, wing_c=3.6, stab_x=23.5 - 4.6, stab_c=2.2, stab_y=0.78,
                    engines=[dict(kind='prop', x=7.0, y=2.2, l=5.0, d=1.15, prop_r=1.95, blades=4)])
S['an-26b'] = dict(S['an-24rv'], L=23.8, upsweep=1.0, cone=7.6, windows=round_windows(5.4, 11.0, 1.2, d=0.5), doors=[(3.4, 0.6, 1.1)])
S['xian-ma60'] = dict(S['an-24rv'], L=24.7, cockpit='jet', nose=4.8, fin_x=24.7 - 6.5, dorsal=1.8,
                      windows=round_windows(5.4, 18.0, 0.95, d=0.40), doors=[(3.2, 0.7, 1.4), (18.6, 0.75, 1.5)],
                      wing_x=9.2, stab_x=24.7 - 4.7,
                      engines=[dict(kind='prop', x=7.6, y=2.25, l=5.2, d=1.2, prop_r=1.98, blades=4)])
S['an-12bk'] = dict(L=33.1, D=3.9, nose=6.4, cone=9.8, nose_tip=0.32, upsweep=1.0, tail_end=0.82, cockpit='glazed',
                    fin_x=33.1 - 8.4, fin_c=6.4, fin_h=6.0, fin_sweep=0.65, fin_tip_c=0.42, dorsal=2.2,
                    windows=round_windows(5.6, 9.0, 1.2, d=0.42), doors=[(4.4, 0.7, 1.4)],
                    high_wing=True, wing_x=12.6, wing_c=4.8, stab_x=33.1 - 5.6, stab_c=2.8, stab_y=0.9,
                    engines=[dict(kind='prop', x=10.0, y=3.05, l=6.0, d=1.25, prop_r=2.25, blades=4),
                             dict(kind='prop', x=10.9, y=3.25, l=5.6, d=1.1, prop_r=2.1, blades=4)])
S['l-382g'] = dict(L=32.3, D=4.1, nose=6.0, cone=9.4, nose_tip=0.38, upsweep=1.0, tail_end=0.85,
                   fin_x=32.3 - 8.6, fin_c=6.8, fin_h=7.2, fin_sweep=0.55, fin_tip_c=0.5, dorsal=1.6,
                   windows=round_windows(5.0, 6.6, 0.9, d=0.42), doors=[(4.6, 0.95, 1.8)],
                   high_wing=True, wing_x=11.6, wing_c=5.0, stab_x=32.3 - 5.8, stab_c=3.4, stab_y=0.88,
                   engines=[dict(kind='prop', x=9.6, y=3.3, l=6.2, d=1.3, prop_r=2.05, blades=4),
                            dict(kind='prop', x=10.4, y=3.45, l=5.8, d=1.15, prop_r=1.95, blades=4)])
S['il-76td-90'] = dict(L=46.6, D=4.8, nose=8.4, cone=12.0, nose_tip=0.30, upsweep=1.0, tail_end=0.82, cockpit='glazed',
                       fin_x=46.6 - 11.0, fin_c=8.0, fin_h=8.2, fin_sweep=1.0, fin_tip_c=0.7, t_tail=True, stab_c=4.6,
                       windows=round_windows(7.4, 9.6, 1.1, d=0.4), doors=[(5.8, 0.9, 1.6)],
                       high_wing=True, wing_x=17.4, wing_c=7.4,
                       engines=[dict(kind='fan', x=14.8, y=2.8, l=6.0, d=1.85), dict(kind='fan', x=16.6, y=3.0, l=5.8, d=1.7)])
S['an-124-100'] = dict(L=69.1, D=7.3, nose=11.0, cone=17.5, nose_tip=0.30, upsweep=1.0, tail_end=0.8,
                       fin_x=69.1 - 16.0, fin_c=12.0, fin_h=11.6, fin_sweep=1.1, fin_tip_c=0.42,
                       windows=round_windows(11.5, 15.0, 1.6, d=0.5, y=0.78), doors=[(9.6, 1.0, 1.9, 4.2)],
                       high_wing=True, wing_x=26.0, wing_c=10.4, stab_x=69.1 - 10.0, stab_c=6.4, stab_y=0.82,
                       engines=[dict(kind='fan', x=22.4, y=4.6, l=8.0, d=2.9), dict(kind='fan', x=24.8, y=4.9, l=7.6, d=2.6)])

# --- small aircraft --------------------------------------------------------
S['emb-110'] = dict(L=15.1, D=1.85, nose=3.6, cone=4.2, nose_tip=0.40, upsweep=0.64, tail_end=0.8,
                    fin_x=15.1 - 4.0, fin_c=2.9, fin_h=2.6, fin_sweep=0.75, fin_tip_c=0.45, dorsal=1.6,
                    windows=dict(**{'from': 4.4, 'to': 10.4}, pitch=0.86, skip=[], y=0.58, w=0.42, h=0.36),
                    doors=[(10.8, 0.7, 1.35)], wing_x=4.8, wing_c=2.2, span_vis=5.2, dihedral=0.6, stab_x=15.1 - 2.6, stab_c=1.5, stab_y=0.72,
                    engines=[dict(kind='prop', x=3.6, y=0.42, l=3.0, d=0.8, prop_r=1.18, blades=3)])
S['do-228ng'] = dict(L=16.6, D=1.75, nose=3.8, cone=4.6, nose_tip=0.40, upsweep=0.62, tail_end=0.8, blunt=0.6,
                     fin_x=16.6 - 4.3, fin_c=3.1, fin_h=2.8, fin_sweep=0.55, fin_tip_c=0.55, dorsal=1.2,
                     windows=dict(**{'from': 4.6, 'to': 11.6}, pitch=0.9, skip=[], y=0.56, w=0.46, h=0.40),
                     doors=[(12.1, 1.2, 1.35)], high_wing=True, wing_x=5.4, wing_c=2.0, stab_x=16.6 - 2.6, stab_c=1.6, stab_y=0.72,
                     engines=[dict(kind='prop', x=4.4, y=1.55, l=3.2, d=0.78, prop_r=1.38, blades=5)])
S['l-410-uvp'] = dict(L=14.4, D=1.95, nose=3.4, cone=4.2, nose_tip=0.40, upsweep=0.6, tail_end=0.8, blunt=0.4,
                      fin_x=14.4 - 4.0, fin_c=3.0, fin_h=2.9, fin_sweep=0.6, fin_tip_c=0.5, dorsal=1.3,
                      windows=dict(**{'from': 4.2, 'to': 9.8}, pitch=0.82, skip=[], y=0.56, w=0.42, h=0.42),
                      doors=[(10.3, 1.2, 1.46)], high_wing=True, wing_x=4.8, wing_c=2.0, stab_x=14.4 - 2.7, stab_c=1.5, stab_y=0.74,
                      engines=[dict(kind='prop', x=3.8, y=1.75, l=3.0, d=0.82, prop_r=1.15, blades=5)])
S['metro-23'] = dict(L=18.1, D=1.65, nose=4.6, cone=4.8, nose_tip=0.38, upsweep=0.66, tail_end=0.82,
                     fin_x=18.1 - 4.0, fin_c=2.8, fin_h=2.4, fin_sweep=1.0, fin_tip_c=0.42,
                     windows=dict(**{'from': 5.2, 'to': 12.4}, pitch=0.8, skip=[], y=0.6, w=0.34, h=0.34, round=True),
                     doors=[(4.4, 0.66, 1.3), (13.4, 1.3, 1.3)], wing_x=6.4, wing_c=2.3, span_vis=5.4, dihedral=0.7,
                     stab_x=18.1 - 2.4, stab_c=1.4, stab_y=1.1,
                     engines=[dict(kind='prop', x=5.0, y=0.48, l=3.2, d=0.76, prop_r=1.3, blades=4)])
S['metro-3-cargo'] = dict(S['metro-23'], windows=dict(S['metro-23']['windows'], **{'to': 7.2}))
S['c402c'] = dict(L=11.1, D=1.45, nose=3.0, cone=3.6, nose_tip=0.40, upsweep=0.62, tail_end=0.8,
                  fin_x=11.1 - 3.0, fin_c=2.2, fin_h=1.9, fin_sweep=0.8, fin_tip_c=0.5, dorsal=0.8,
                  windows=dict(**{'from': 4.1, 'to': 6.8}, pitch=0.72, skip=[], y=0.6, w=0.44, h=0.34),
                  doors=[(7.2, 0.7, 1.15)], wing_x=3.4, wing_c=1.9, span_vis=4.2, dihedral=0.55, stab_x=11.1 - 2.0, stab_c=1.1, stab_y=0.72,
                  engines=[dict(kind='piston', x=2.0, y=0.48, l=3.0, d=0.66, prop_r=0.95, blades=3)])
S['tecnam-p2012'] = dict(L=11.8, D=1.6, nose=2.8, cone=4.0, nose_tip=0.38, upsweep=0.62, tail_end=0.8, blunt=0.3,
                         fin_x=11.8 - 3.2, fin_c=2.3, fin_h=2.0, fin_sweep=0.55, fin_tip_c=0.6, dorsal=0.6,
                         windows=dict(**{'from': 3.6, 'to': 7.2}, pitch=0.9, skip=[], y=0.58, w=0.56, h=0.44),
                         doors=[(7.6, 0.8, 1.2)], high_wing=True, wing_x=3.2, wing_c=1.6, stab_x=11.8 - 2.0, stab_c=1.2, stab_y=0.74,
                         engines=[dict(kind='piston', x=2.4, y=1.45, l=2.6, d=0.62, prop_r=0.95, blades=3)],
                         gear=[(2.0, 0.26, 0.55), (5.8, 0.32, 0.6)])
CARAVAN = dict(L=12.7, D=1.7, nose=3.4, cone=4.6, nose_tip=0.48, upsweep=0.62, tail_end=0.8, cockpit_x=1.6,
               fin_x=12.7 - 3.3, fin_c=2.5, fin_h=2.3, fin_sweep=0.6, fin_tip_c=0.55, dorsal=1.4,
               windows=dict(**{'from': 4.2, 'to': 8.0}, pitch=0.82, skip=[], y=0.6, w=0.40, h=0.38),
               doors=[(8.4, 0.9, 1.2)], high_wing=True, strut=True, wing_x=3.4, wing_c=2.0, stab_x=12.7 - 2.2, stab_c=1.3, stab_y=0.72,
               engines=[dict(kind='prop', x=0.05, y=0.62, l=2.2, d=0.95, prop_r=1.3, blades=3)],
               gear=[(0.9, 0.3, 0.7), (4.4, 0.34, 0.75)])
S['c208b-ex'] = CARAVAN
S['c208b-cargo'] = dict(CARAVAN, windows=dict(CARAVAN['windows'], **{'to': 4.3}), doors=[(7.6, 1.3, 1.25)])
S['c408'] = dict(L=16.7, D=2.1, nose=3.4, cone=5.2, nose_tip=0.42, upsweep=0.62, tail_end=0.8, blunt=0.7,
                 fin_x=16.7 - 4.4, fin_c=3.3, fin_h=3.0, fin_sweep=0.5, fin_tip_c=0.6, dorsal=1.0,
                 windows=dict(**{'from': 4.0, 'to': 8.6}, pitch=1.15, skip=[], y=0.6, w=0.5, h=0.42),
                 doors=[(10.2, 1.85, 1.5), (3.0, 0.6, 1.2)], high_wing=True, strut=True, wing_x=5.0, wing_c=2.1, stab_x=16.7 - 2.8, stab_c=1.7, stab_y=0.78,
                 engines=[dict(kind='prop', x=3.8, y=1.85, l=3.2, d=0.8, prop_r=1.15, blades=4)],
                 gear=[(2.4, 0.32, 0.7), (7.4, 0.36, 0.72)])
S['pilatus-pc12'] = dict(L=14.4, D=1.6, nose=3.4, cone=4.6, nose_tip=0.48, upsweep=0.64, tail_end=0.82, cockpit_x=1.7,
                         fin_x=14.4 - 3.8, fin_c=2.6, fin_h=2.4, fin_sweep=0.85, fin_tip_c=0.6, t_tail=True, dorsal=0.6, stab_c=1.4,
                         windows=dict(**{'from': 4.6, 'to': 8.4}, pitch=0.78, skip=[], y=0.6, w=0.42, h=0.46),
                         doors=[(9.2, 1.35, 1.35), (3.2, 0.62, 1.2)], wing_x=4.0, wing_c=2.1, span_vis=4.6, dihedral=0.7, winglet=True,
                         engines=[dict(kind='prop', x=0.05, y=0.6, l=2.4, d=0.95, prop_r=1.3, blades=5)])
