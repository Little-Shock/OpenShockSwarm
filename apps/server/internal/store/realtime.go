package store

func (s *Store) SubscribeState() (int, <-chan State) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.subscribers == nil {
		s.subscribers = make(map[int]chan State)
	}

	s.nextSubID++
	id := s.nextSubID
	ch := make(chan State, 1)
	s.subscribers[id] = ch
	return id, ch
}

func (s *Store) UnsubscribeState(id int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	ch, ok := s.subscribers[id]
	if !ok {
		return
	}
	delete(s.subscribers, id)
	close(ch)
}

func (s *Store) publishSnapshotLocked() {
	if len(s.subscribers) == 0 {
		return
	}

	snapshot := cloneState(s.state)
	for _, ch := range s.subscribers {
		select {
		case ch <- snapshot:
		default:
			select {
			case <-ch:
			default:
			}
			select {
			case ch <- snapshot:
			default:
			}
		}
	}
}
